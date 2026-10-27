import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
} from '@miaoma/video-agent/llm';
import type {
  ChatMessage,
  ChatMessageOfType,
  ChatStreamEvent,
  RunEvent,
} from '@miaoma/video-project';
import { ChatService } from '../chat/chat-service';
import { ChatStore } from '../chat/chat-store';
import { ProjectStore } from '../projects/project-store';
import { desktopPromptProvider } from './prompts';
import { WorkflowRunManager } from './run-manager';

const FFMPEG =
  process.platform === 'win32'
    ? path.resolve('resources/ffmpeg/ffmpeg.exe')
    : 'ffmpeg';
const FFPROBE =
  process.platform === 'win32'
    ? path.resolve('resources/ffmpeg/ffprobe.exe')
    : 'ffprobe';

function canRun(binary: string): boolean {
  return spawnSync(binary, ['-version'], { windowsHide: true }).status === 0;
}

// The bundled binaries are Windows executables; checking that they actually
// run lets the suite skip on platforms that cannot execute them (Linux CI, or
// WSL without Windows interop) instead of failing on spawn.
const HAS_FFMPEG = canRun(FFMPEG) && canRun(FFPROBE);

const SCRIPT =
  '这是第一段测试旁白，用来验证完整流程。这是第二段测试旁白，用来验证分镜、配音、匹配、组装和保存。';

function briefPayload() {
  return {
    contentType: 'knowledge',
    title: '端到端测试视频',
    topic: '工作流验证',
    summary: '验证扫描、简报、分镜、配音、匹配、组装、校验与保存。',
    audience: {
      primary: '测试用户',
      description: '用于验证完整流水线。',
      needs: ['确认流程可以跑通'],
    },
    style: { toneKeywords: ['清晰'], visualTone: '简洁', pacing: 'medium' },
    durationSeconds: 15,
    coreMessage: {
      statement: '完整流水线可以跑通。',
      supportingPoints: ['扫描与关键帧', '审批与组装'],
    },
    narrativeStructure: {
      type: 'hook_explain_cta',
      beats: [
        { label: '开场', purpose: '引入', summary: '第一段旁白', estimatedSeconds: 7 },
        { label: '主体', purpose: '验证', summary: '第二段旁白', estimatedSeconds: 8 },
      ],
    },
    coverageIssues: [],
    openQuestions: [],
  };
}

function scenePlanPayload() {
  return {
    summary: '两个直切分镜。',
    scenes: [
      {
        title: '开场',
        script: '这是第一段测试旁白，用来验证完整流程。',
        visualIntent: '测试画面',
        goal: '引入',
        notes: '',
        estimatedSeconds: 7,
      },
      {
        title: '主体',
        script: '这是第二段测试旁白，用来验证分镜、配音、匹配、组装和保存。',
        visualIntent: '测试画面',
        goal: '验证',
        notes: '',
        estimatedSeconds: 8,
      },
    ],
    issues: [],
  };
}

function analysisText(): string {
  return [
    '<<<INTRO>>>',
    '我来分析你的文稿，这是一份结构清晰的测试口播稿。整体时间线明确，适合直接进入制作。',
    '<<<STRUCTURE>>>',
    '这是一份完整的测试文稿，包含 2 个时间段的内容：',
    '<<<SCRIPT_TYPE>>>',
    '文稿已经包含时间轴和画面意图，属于需要先转化为纯口播文稿的类型。',
    '<<<VOICEOVER>>>',
    '这是第一段测试旁白，用来验证完整流程。',
    '',
    '这是第二段测试旁白，用来验证分镜、配音、匹配、组装和保存。',
    '<<<SCHEME>>>',
    '推荐素材匹配 + 基础剪辑（material_edit），使用现有素材按语义匹配画面，并保留原始口播信息。',
  ].join('\n');
}

class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake';
  readonly defaultModel = 'fake-model';

  getCapabilities() {
    return {
      provider: 'fake',
      model: 'fake-model',
      streaming: true,
      reasoning: false,
    };
  }

  async generate(
    messages: readonly LlmMessage[],
    _options?: LlmGenerationOptions,
  ): Promise<LlmGenerationResult> {
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const payload = system.includes('分镜规划师') ? scenePlanPayload() : briefPayload();

    return {
      text: JSON.stringify(payload),
      model: 'fake-model',
      finishReason: 'stop',
    };
  }

  async *stream(
    messages: readonly LlmMessage[],
    _options?: LlmGenerationOptions,
  ): AsyncGenerator<LlmStreamEvent, void, void> {
    const system = messages.find((message) => message.role === 'system')?.content ?? '';

    if (!system.includes('文稿分析编剧')) {
      throw new Error('unexpected stream request');
    }

    const text = analysisText();
    const chunks = [text.slice(0, 80), text.slice(80, 180), text.slice(180)];

    for (const delta of chunks) {
      yield { delta, type: 'content' };
    }

    yield {
      result: { finishReason: 'stop', model: 'fake-model', text },
      type: 'done',
    };
  }
}

function waitForEvent(
  manager: WorkflowRunManager,
  predicate: (event: RunEvent) => boolean,
  timeoutMs = 30_000,
): Promise<RunEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.off('event', listener);
      reject(new Error('timed out waiting for run event'));
    }, timeoutMs);

    const listener = (event: RunEvent) => {
      if (predicate(event)) {
        clearTimeout(timer);
        manager.off('event', listener);
        resolve(event);
      }
    };

    manager.on('event', listener);
  });
}

async function waitForMessage(
  chatStore: ChatStore,
  projectId: string,
  predicate: (message: ChatMessage) => boolean,
  timeoutMs = 20_000,
): Promise<ChatMessage> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = chatStore.read(projectId).find(predicate);

    if (found) {
      return found;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('timed out waiting for chat message');
}

describe.skipIf(!HAS_FFMPEG)('workflow end-to-end', () => {
  let root: string;
  let assetsRoot: string;
  let store: ProjectStore;
  let manager: WorkflowRunManager;
  let chatStore: ChatStore;
  let chatService: ChatService;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'miaoma-workflow-e2e-'));
    assetsRoot = path.join(root, 'assets');
    mkdirSync(assetsRoot, { recursive: true });
    const videoPath = path.join(assetsRoot, 'sample.mp4');
    const result = spawnSync(
      FFMPEG,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x336699:s=320x180:d=20:r=30',
        '-pix_fmt',
        'yuv420p',
        videoPath,
      ],
      { encoding: 'utf8', windowsHide: true },
    );

    if (result.status !== 0) {
      throw new Error(`ffmpeg failed: ${result.stderr}`);
    }

    store = new ProjectStore(path.join(root, 'projects'));
    const project = store.create({ name: '端到端测试' });
    projectId = project.project.projectId;
    store.writeCreationInput(projectId, {
      script: SCRIPT,
      voicePresetId: 'wenrou-xuejie',
      assetPath: assetsRoot,
    });

    manager = new WorkflowRunManager({
      getProjectStore: () => store,
      getLlmProvider: () => new FakeLlmProvider(),
      prompts: desktopPromptProvider,
      media: {
        isPackaged: false,
        appPath: process.cwd(),
        resourcesPath: process.cwd(),
      },
    });
    chatStore = new ChatStore(() => store);
    chatService = new ChatService({
      getProjectStore: () => store,
      runManager: manager,
      chatStore,
    });
    manager.on('event', (event) => {
      chatService.handleEvent(event);
    });
  });

  afterEach(async () => {
    try {
      const record = manager.getRecord(projectId);
      if (record) {
        await manager.cancel(projectId, record.runId).catch(() => undefined);
      }
    } catch {
      // 清理阶段忽略取消错误。
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
  });

  it('runs scan → brief → scenes → voice → match → assemble → validate → save', async () => {
    const streams: ChatStreamEvent[] = [];
    manager.on('stream', (event: ChatStreamEvent) => streams.push(event));

    const a1 = waitForEvent(
      manager,
      (event) => event.type === 'node.waiting_user' && event.gate === 'A1',
    );
    await manager.start(projectId);
    const a1Event = await a1;
    const runId = a1Event.runId;

    const a2 = waitForEvent(
      manager,
      (event) => event.type === 'node.waiting_user' && event.gate === 'A2',
    );
    await manager.resume(projectId, runId, { decision: 'approve' });
    await a2;

    const a3 = waitForEvent(
      manager,
      (event) => event.type === 'node.waiting_user' && event.gate === 'A3',
    );
    await manager.resume(projectId, runId, { decision: 'approve' });
    await a3;

    const completed = waitForEvent(
      manager,
      (event) => event.type === 'run.completed' || event.type === 'run.failed',
    );
    await manager.resume(projectId, runId, { decision: 'approve' });
    const terminal = await completed;

    expect(terminal.type).toBe('run.completed');

    const state = manager.getState(projectId);
    expect(state?.status).toBe('succeeded');
    expect(state?.saved).toBe(true);

    const projectDirectory = store.getProjectDirectory(projectId);
    const saved = JSON.parse(readFileSync(path.join(projectDirectory, 'project.json'), 'utf8')) as {
      ai?: { completedAt?: string };
      scenes?: unknown[];
      tracks?: { kind: string }[];
    };

    expect(saved.ai?.completedAt).toBeTruthy();
    expect(saved.scenes).toHaveLength(2);
    expect(saved.tracks?.map((track) => track.kind).sort()).toEqual([
      'music',
      'subtitle',
      'video',
      'voice',
    ]);
    expect(existsSync(path.join(projectDirectory, 'analysis', 'saved'))).toBe(true);

    const finalStream = streams.at(-1);
    expect(finalStream?.done).toBe(true);
    expect(finalStream?.draft.intro).toContain('我来分析你的文稿');
    expect(finalStream?.draft.scriptType).toContain('纯口播');
    expect(finalStream?.draft.voiceoverScript).toContain('第一段测试旁白');
    expect(finalStream?.draft.beats).toHaveLength(2);

    const brief = JSON.parse(
      readFileSync(path.join(projectDirectory, 'analysis/brief/creative-brief.v1.json'), 'utf8'),
    ) as { scriptAnalysis?: { voiceoverScript?: string } };
    expect(brief.scriptAnalysis?.voiceoverScript).toContain('第一段测试旁白');
  }, 120_000);

  it('drives the flow through ChatService and persists message cards', async () => {
    await chatService.start(projectId);

    await waitForMessage(
      chatStore,
      projectId,
      (message) => message.type === 'approval_request' && message.payload.gate === 'A1',
    );
    await chatService.send(projectId, '确认');

    await waitForMessage(
      chatStore,
      projectId,
      (message) => message.type === 'approval_request' && message.payload.gate === 'A2',
    );
    await chatService.send(projectId, '确认');

    await waitForMessage(
      chatStore,
      projectId,
      (message) => message.type === 'approval_request' && message.payload.gate === 'A3',
    );
    await chatService.send(projectId, '确认');

    await waitForMessage(
      chatStore,
      projectId,
      (message) => message.type === 'video_overview',
      30_000,
    );

    const result = await chatService.list(projectId);
    const approvals = result.messages.filter(
      (message): message is ChatMessageOfType<'approval_request'> =>
        message.type === 'approval_request',
    );
    const confirmations = result.messages.filter(
      (message): message is ChatMessageOfType<'user_confirmation'> =>
        message.type === 'user_confirmation',
    );

    expect(approvals.map((message) => message.payload.gate)).toEqual(['A1', 'A2', 'A3']);
    expect(confirmations).toHaveLength(3);
    expect(confirmations.every((message) => message.payload.decision === 'approve')).toBe(true);
    expect(result.messages.some((message) => message.type === 'script_analysis')).toBe(true);
    expect(result.messages.some((message) => message.type === 'production_spec')).toBe(true);
    expect(result.messages.some((message) => message.type === 'video_overview')).toBe(true);
    expect(
      result.messages.some(
        (message) =>
          message.type === 'system_notice' && message.payload.message.includes('模拟配音'),
      ),
    ).toBe(true);
    expect(result.workflow?.status).toBe('succeeded');
    expect(result.workflow?.saved).toBe(true);

    await chatService.send(projectId, '把第二段改得更突出产品');
    await waitForMessage(
      chatStore,
      projectId,
      (message) =>
        message.type === 'approval_request' &&
        message.payload.gate === 'A1' &&
        message.payload.artifact.version === 2,
      60_000,
    );

    const revised = await chatService.list(projectId);

    expect(
      revised.messages.some(
        (message) =>
          message.type === 'user_requirement' &&
          message.payload.kind === 'follow_up' &&
          message.payload.text.includes('第二段'),
      ),
    ).toBe(true);
    expect(
      revised.messages.filter(
        (message) => message.type === 'approval_request' && message.payload.gate === 'A1',
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(revised.workflow?.runId).not.toBe(result.workflow?.runId);
    expect(revised.workflow?.status).toBe('waiting_user');
  }, 120_000);
});
