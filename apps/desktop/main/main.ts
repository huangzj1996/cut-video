import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import started from 'electron-squirrel-startup';
import {
  chat,
  createDeepSeekProviderFromEnv,
  LlmError,
  type LlmMessage,
  type LlmProvider,
} from '@miaoma/video-agent/llm';
import {
  ApprovalDecisionSchema,
  ArtifactReferenceSchema,
  type CreationInputDraft,
} from '@miaoma/video-project';
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type AppInfo,
  type AppSettings,
  type IpcChannel,
  type IpcHandler,
  type IpcParams,
  type IpcResponse,
  type IpcResult,
  type MediaInfo,
} from '../shared/ipc-contract';
import { ChatService } from './chat/chat-service';
import { ChatStore } from './chat/chat-store';
import { CloseFlushCoordinator } from './editor/close-flush';
import { IpcError, toIpcErrorPayload } from './ipc-error';
import { registerAssetProtocol, registerAssetScheme } from './media/asset-protocol-handler';
import { isBinaryAvailable } from './media/binary-check';
import { resolveMediaBinary } from './media/ffmpeg-path';
import { ProjectStore } from './projects/project-store';
import { loadSettings } from './settings';
import { readPublicArtifact } from './workflow/artifact-reader';
import {
  broadcastChatMessage,
  broadcastChatStream,
  broadcastWorkflowEvent,
} from './workflow/event-bridge';
import { desktopPromptProvider } from './workflow/prompts';
import { WorkflowRunManager } from './workflow/run-manager';

if (started) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.miaoma.magicut');
}

// 自定义协议必须在 app ready 之前登记；渲染进程只认 assetId，不触碰 file://。
registerAssetScheme();

function buildMediaInfo(): MediaInfo {
  const common = {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  } as const;

  const ffmpegPath = resolveMediaBinary({ ...common, name: 'ffmpeg' });
  const ffprobePath = resolveMediaBinary({ ...common, name: 'ffprobe' });

  return {
    ffmpegPath,
    ffprobePath,
    ffmpegExists: isBinaryAvailable(ffmpegPath),
    ffprobeExists: isBinaryAvailable(ffprobePath),
  };
}

/**
 * 开发态从仓库根 `.env` 读取 DeepSeek 配置。
 * 打包态不读取 `.env`，后续由 settings + safeStorage 注入密钥。
 */
function loadDevelopmentEnv(): void {
  if (app.isPackaged) {
    return;
  }

  const candidates = [
    path.resolve(app.getAppPath(), '../..', '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../..', '.env'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      process.loadEnvFile(candidate);
    } catch {
      // 读取失败时保持现有环境变量，由 LLM 调用返回明确错误。
    }

    return;
  }
}

let llmProvider: LlmProvider | undefined;

function getLlmProvider(): LlmProvider {
  if (!llmProvider) {
    llmProvider = createDeepSeekProviderFromEnv();
  }

  return llmProvider;
}

function parseLlmMessages(raw: unknown): LlmMessage[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    throw new IpcError('LLM_INVALID_ARGUMENT', '对话消息无效。');
  }

  let totalCharacters = 0;

  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      throw new IpcError('LLM_INVALID_ARGUMENT', '对话消息无效。');
    }

    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;

    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new IpcError('LLM_INVALID_ARGUMENT', '对话角色无效。');
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new IpcError('LLM_INVALID_ARGUMENT', '对话内容不能为空。');
    }

    totalCharacters += content.length;

    if (totalCharacters > 20_000) {
      throw new IpcError('LLM_INVALID_ARGUMENT', '对话内容过长。');
    }

    return { content, role };
  });
}

function getProjectStore(): ProjectStore {
  try {
    return new ProjectStore(loadSettings().defaultProjectDirectory);
  } catch {
    throw new IpcError('SETTINGS_READ_FAILED', '读取应用设置失败。', true);
  }
}

let workflowRunManager: WorkflowRunManager | null = null;
let chatService: ChatService | null = null;
let activeCloseFlush: CloseFlushCoordinator | null = null;

function getWorkflowRunManager(): WorkflowRunManager {
  if (workflowRunManager) {
    return workflowRunManager;
  }

  const manager = new WorkflowRunManager({
    getProjectStore,
    getLlmProvider,
    prompts: desktopPromptProvider,
    media: {
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    },
  });

  manager.on('event', (event) => {
    broadcastWorkflowEvent(event);
    getChatService().handleEvent(event);
  });
  manager.on('stream', broadcastChatStream);
  workflowRunManager = manager;
  return manager;
}

function getChatService(): ChatService {
  if (chatService) {
    return chatService;
  }

  chatService = new ChatService({
    getProjectStore,
    runManager: getWorkflowRunManager(),
    chatStore: new ChatStore(getProjectStore),
    onMessage: broadcastChatMessage,
  });

  return chatService;
}

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目 ID 无效。');
  }

  return value;
}

function assertRunId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new IpcError('WORKFLOW_INVALID_ARGUMENT', '运行 ID 无效。');
  }

  return value;
}

function handle<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(
    channel,
    async (_event, ...params: unknown[]): Promise<IpcResponse<IpcResult<C>>> => {
      try {
        const data = await handler(...(params as IpcParams<C>));
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: toIpcErrorPayload(error) };
      }
    },
  );
}

function registerIpcHandlers(): void {
  handle(IPC_CHANNELS.app.ping, () => 'pong');

  handle(IPC_CHANNELS.app.getInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
      chrome: process.versions.chrome ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
    };
  });

  handle(IPC_CHANNELS.settings.get, (): AppSettings => {
    try {
      return loadSettings();
    } catch {
      throw new IpcError('SETTINGS_READ_FAILED', '读取应用设置失败。', true);
    }
  });

  handle(IPC_CHANNELS.media.getInfo, () => {
    try {
      return buildMediaInfo();
    } catch {
      throw new IpcError('MEDIA_INFO_FAILED', '媒体工具检测失败。', true);
    }
  });

  handle(IPC_CHANNELS.project.list, () => getProjectStore().list());
  handle(IPC_CHANNELS.project.get, (projectId) => getProjectStore().get(projectId));
  handle(IPC_CHANNELS.project.update, (input) => getProjectStore().update(input));
  handle(IPC_CHANNELS.project.delete, (projectId) => getProjectStore().delete(projectId));

  // 渲染进程完成关闭前的保存后确认；主进程最多等 2 秒。
  handle(IPC_CHANNELS.editor.flushComplete, () => {
    activeCloseFlush?.complete();
    return null;
  });

  handle(IPC_CHANNELS.project.selectAssets, async (projectId) => {
    const id = assertProjectId(projectId);
    const store = getProjectStore();
    const creation = store.readCreationInput(id);
    const result = await dialog.showOpenDialog({
      title: '选择视频素材目录',
      buttonLabel: '使用此目录',
      properties: ['openDirectory'],
    });
    const selectedPath = result.filePaths[0];

    if (result.canceled || !selectedPath) {
      return { selected: false };
    }

    store.writeCreationInput(id, {
      script: creation.script,
      ...(creation.requirementsText !== undefined
        ? { requirementsText: creation.requirementsText }
        : {}),
      voicePresetId: creation.voicePresetId,
      assetPath: selectedPath,
    });

    return { selected: true };
  });

  handle(IPC_CHANNELS.project.create, (input) => {
    const assetPath = (input as { assetPath?: unknown } | undefined)?.assetPath;

    if (assetPath !== undefined && typeof assetPath !== 'string') {
      throw new IpcError('ASSET_INVALID_ARGUMENT', '素材路径无效。');
    }

    const projectStore = getProjectStore();
    const project = projectStore.create(input);
    const projectId = project.project.projectId;
    const creation = (input as { creation?: unknown } | undefined)?.creation;

    if (creation !== undefined) {
      try {
        projectStore.writeCreationInput(projectId, creation as CreationInputDraft);
      } catch (error) {
        try {
          projectStore.delete(projectId);
        } catch {
          // 回滚失败时保留原始错误。
        }

        throw error;
      }
    }

    return project;
  });

  handle(IPC_CHANNELS.llm.chat, async (rawMessages) => {
    const messages = parseLlmMessages(rawMessages);
    let provider: LlmProvider;

    try {
      provider = getLlmProvider();
    } catch (error) {
      if (error instanceof LlmError && error.code === 'LLM_CONFIG_MISSING_API_KEY') {
        throw new IpcError('LLM_NOT_CONFIGURED', error.message, false);
      }

      throw new IpcError('LLM_NOT_CONFIGURED', '模型配置无效。', false);
    }

    try {
      const result = await chat(provider, messages);
      const usage = result.usage
        ? {
            ...(result.usage.inputTokens !== undefined
              ? { inputTokens: result.usage.inputTokens }
              : {}),
            ...(result.usage.outputTokens !== undefined
              ? { outputTokens: result.usage.outputTokens }
              : {}),
            ...(result.usage.totalTokens !== undefined
              ? { totalTokens: result.usage.totalTokens }
              : {}),
          }
        : undefined;

      return {
        model: result.model,
        reply: result.text,
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (error instanceof LlmError) {
        throw new IpcError('LLM_REQUEST_FAILED', error.message, error.retryable, {
          llmCode: error.code,
        });
      }

      throw new IpcError('LLM_REQUEST_FAILED', '模型调用失败。', false);
    }
  });

  handle(IPC_CHANNELS.chat.list, (projectId) => getChatService().list(assertProjectId(projectId)));

  handle(IPC_CHANNELS.chat.start, (projectId) =>
    getChatService().start(assertProjectId(projectId)),
  );

  handle(IPC_CHANNELS.chat.send, (input) => {
    const raw = input as { projectId?: unknown; text?: unknown } | undefined;
    const projectId = assertProjectId(raw?.projectId);

    if (typeof raw?.text !== 'string' || raw.text.trim().length === 0) {
      throw new IpcError('CHAT_INVALID_ARGUMENT', '请输入审批回复。');
    }

    if (raw.text.length > 2_000) {
      throw new IpcError('CHAT_INVALID_ARGUMENT', '审批回复过长。');
    }

    return getChatService().send(projectId, raw.text);
  });

  handle(IPC_CHANNELS.chat.retry, (projectId) =>
    getChatService().retry(assertProjectId(projectId)),
  );

  handle(
    IPC_CHANNELS.workflow.getState,
    (projectId) => getWorkflowRunManager().getState(assertProjectId(projectId)) ?? null,
  );

  handle(IPC_CHANNELS.workflow.resume, (input) => {
    const raw = input as { projectId?: unknown; runId?: unknown; decision?: unknown } | undefined;
    const projectId = assertProjectId(raw?.projectId);
    const runId = assertRunId(raw?.runId);
    let decision;

    if (raw?.decision !== undefined) {
      const parsed = ApprovalDecisionSchema.safeParse(raw.decision);

      if (!parsed.success) {
        throw new IpcError('WORKFLOW_INVALID_ARGUMENT', '审批回复无效。', false, {
          issues: parsed.error.issues.slice(0, 10).map((issue) => ({
            message: issue.message,
            path: issue.path.map(String).join('.'),
          })),
        });
      }

      decision = parsed.data;
    }

    return getWorkflowRunManager().resume(projectId, runId, decision);
  });

  handle(IPC_CHANNELS.workflow.cancel, (input) => {
    const raw = input as { projectId?: unknown; runId?: unknown } | undefined;

    return getWorkflowRunManager().cancel(assertProjectId(raw?.projectId), assertRunId(raw?.runId));
  });

  handle(IPC_CHANNELS.workflow.getArtifact, async (input) => {
    const raw = input as { projectId?: unknown; reference?: unknown } | undefined;
    const projectId = assertProjectId(raw?.projectId);
    const parsed = ArtifactReferenceSchema.safeParse(raw?.reference);

    if (!parsed.success) {
      throw new IpcError('WORKFLOW_INVALID_ARGUMENT', '产物引用无效。');
    }

    return readPublicArtifact(getProjectStore(), projectId, parsed.data);
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: '妙剪 Magicut',
    backgroundColor: '#0D1015',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 关窗前先让渲染进程 flush 未保存编辑；最多等 2 秒，超时直接销毁窗口。
  const closeFlush = new CloseFlushCoordinator({
    requestFlush: () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.editorFlushRequest, null);
      }
    },
  });

  activeCloseFlush = closeFlush;

  mainWindow.on('close', (event) => {
    if (mainWindow.isDestroyed()) {
      return;
    }

    event.preventDefault();

    void closeFlush.begin().then(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
    });
  });

  mainWindow.on('closed', () => {
    if (activeCloseFlush === closeFlush) {
      activeCloseFlush = null;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.MIAOMA_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

void app.whenReady().then(() => {
  loadDevelopmentEnv();
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  registerAssetProtocol((projectId) => getProjectStore().get(projectId));
  getWorkflowRunManager().recover();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
