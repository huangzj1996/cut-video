import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import started from 'electron-squirrel-startup';
import { extractKeyframes, probeVideoResult } from '@miaoma/video-agent';
import {
  chat,
  createDeepSeekProviderFromEnv,
  LlmError,
  type LlmMessage,
  type LlmProvider,
} from '@miaoma/video-agent/llm';
import {
  IPC_CHANNELS,
  type AppInfo,
  type AppSettings,
  type IpcChannel,
  type IpcHandler,
  type IpcParams,
  type IpcResponse,
  type IpcResult,
  type MediaInfo,
} from '../shared/ipc-contract';
import { attachKeyframes } from './assets/keyframe-assets';
import { buildAssetSelectionManifest, prepareProjectAssets } from './assets/project-assets';
import { IpcError, toIpcErrorPayload } from './ipc-error';
import { resolveMediaBinary } from './media/ffmpeg-path';
import { ProjectStore } from './projects/project-store';
import { loadSettings } from './settings';

if (started) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.miaoma.magicut');
}

function isBinaryAvailable(binaryPath: string): boolean {
  if (path.isAbsolute(binaryPath)) {
    return existsSync(binaryPath);
  }

  const result = spawnSync(binaryPath, ['-version'], {
    windowsHide: true,
    stdio: 'ignore',
  });

  return result.status === 0;
}

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

function resolveFfprobeExecutable(): string {
  return resolveMediaBinary({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    name: 'ffprobe',
  });
}

function resolveFfmpegExecutable(): string {
  return resolveMediaBinary({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    name: 'ffmpeg',
  });
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

  handle(IPC_CHANNELS.project.create, async (input) => {
    const assetPath = (input as { assetPath?: unknown } | undefined)?.assetPath;

    if (assetPath !== undefined && typeof assetPath !== 'string') {
      throw new IpcError('ASSET_INVALID_ARGUMENT', '素材路径无效。');
    }

    const trimmedAssetPath = typeof assetPath === 'string' ? assetPath.trim() : '';
    let prepared: Awaited<ReturnType<typeof prepareProjectAssets>> | undefined;
    let ffmpegPath: string | undefined;

    if (trimmedAssetPath) {
      const ffprobePath = resolveFfprobeExecutable();

      if (!isBinaryAvailable(ffprobePath)) {
        throw new IpcError(
          'ASSET_PROBE_UNAVAILABLE',
          '未找到 ffprobe。请将 ffprobe.exe 放入 resources/ffmpeg/，或设置 MIAOMA_FFPROBE_PATH。',
        );
      }

      ffmpegPath = resolveFfmpegExecutable();

      if (!isBinaryAvailable(ffmpegPath)) {
        throw new IpcError(
          'ASSET_KEYFRAME_UNAVAILABLE',
          '未找到 ffmpeg。请将 ffmpeg.exe 放入 resources/ffmpeg/，或设置 MIAOMA_FFMPEG_PATH。',
        );
      }

      prepared = await prepareProjectAssets(trimmedAssetPath, (candidate) =>
        probeVideoResult(ffprobePath, candidate.path),
      );
    }

    const projectStore = getProjectStore();
    let project = projectStore.create(input, prepared ? { assets: prepared.assets } : undefined);
    const projectId = project.project.projectId;

    if (prepared && ffmpegPath) {
      try {
        const cacheRoot = projectStore.getKeyframeCacheDirectory(projectId);
        const attached = await attachKeyframes(prepared, (source) =>
          extractKeyframes(source, { cacheRoot, ffmpegPath }),
        );

        project = projectStore.replaceAssets(projectId, attached.assets);
        projectStore.writeAssetManifest(
          projectId,
          buildAssetSelectionManifest(projectId, prepared, {
            keyframeCacheKeys: attached.cacheKeys,
            keyframeCounts: attached.frameCounts,
            keyframeErrors: attached.errors,
          }),
        );
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
