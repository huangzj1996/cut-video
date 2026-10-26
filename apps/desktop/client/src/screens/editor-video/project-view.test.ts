import { describe, expect, it } from 'vitest';
import type { StoredProject, VideoProject } from '@miaoma/video-project';
import type { IpcResponse } from '../../../../shared/ipc-contract';
import {
  buildEditorProjectView,
  formatUpdatedLabel,
  loadEditorProject,
  type ProjectReader,
} from './project-view';

const NOW = '2026-10-27T10:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const VIDEO_PROJECT: VideoProject = {
  ai: {
    completedAt: NOW,
    inputFingerprint: 'fingerprint',
    model: 'deepseek-chat',
    modelConfigVersion: 'v1',
    provider: 'deepseek',
    runId: 'run-1',
    startedAt: NOW,
  },
  assets: {
    music: [],
    subtitles: [
      { id: 'subtitle-1', language: 'zh-CN', text: '第一句' },
      { id: 'subtitle-2', language: 'zh-CN', text: '第二句' },
    ],
    thumbnails: [],
    videos: [
      {
        durationMs: 10_000,
        fps: 30,
        height: 1080,
        id: 'video-1',
        mediaType: 'video',
        path: 'C:/media/source.mp4',
        thumbnailIds: [],
        width: 1920,
      },
    ],
    voices: [
      {
        durationMs: 4_000,
        id: 'voice-1',
        isMock: true,
        path: 'C:/media/voice-1.wav',
        provider: 'mock',
        voice: 'wenrou-xuejie',
      },
      {
        durationMs: 6_000,
        id: 'voice-2',
        isMock: true,
        path: 'C:/media/voice-2.wav',
        provider: 'mock',
        voice: 'wenrou-xuejie',
      },
    ],
  },
  canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
  project: {
    contentRevision: 3,
    createdAt: '2026-10-26T09:00:00.000Z',
    name: '真实工程',
    projectId: 'project-1',
    updatedAt: NOW,
  },
  render: {
    audioBitrateKbps: 192,
    audioCodec: 'aac',
    burnSubtitles: true,
    container: 'mp4',
    sourceAudioMuted: true,
    videoCodec: 'h264',
  },
  // 数组顺序故意与 index 相反，验证视图按 index 排列。
  scenes: [
    {
      durationMs: 6_000,
      goal: '收尾',
      id: 'scene-2',
      index: 2,
      matchedVideoAssetIds: ['video-1'],
      notes: '',
      script: '第二段文稿',
      subtitleIds: [],
      title: '收尾',
      visualIntent: '街景',
      voiceAssetId: 'voice-2',
    },
    {
      durationMs: 4_000,
      goal: '开场',
      id: 'scene-1',
      index: 1,
      matchedVideoAssetIds: ['video-1'],
      notes: '',
      script: '第一段文稿',
      subtitleIds: ['subtitle-1', 'subtitle-2'],
      title: '开场',
      visualIntent: '办公室',
      voiceAssetId: 'voice-1',
    },
  ],
  schemaVersion: '1.0.0',
  tracks: [
    {
      clips: [
        {
          assetId: 'video-1',
          crop: { height: 1, width: 1, x: 0, y: 0 },
          endMs: 4_000,
          id: 'clip-video-1',
          kind: 'video',
          sceneId: 'scene-1',
          sourceEndMs: 4_000,
          sourceStartMs: 0,
          startMs: 0,
          transform: { scale: 1, x: 0, y: 0 },
        },
        {
          assetId: 'video-1',
          crop: { height: 1, width: 1, x: 0, y: 0 },
          endMs: 10_000,
          id: 'clip-video-2',
          kind: 'video',
          sceneId: 'scene-2',
          sourceEndMs: 10_000,
          sourceStartMs: 4_000,
          startMs: 4_000,
          transform: { scale: 1, x: 0, y: 0 },
        },
      ],
      id: 'track-video',
      kind: 'video',
    },
    {
      clips: [
        {
          assetId: 'voice-1',
          endMs: 4_000,
          id: 'clip-voice-1',
          kind: 'voice',
          sceneId: 'scene-1',
          startMs: 0,
          voicePreset: 'wenrou-xuejie',
        },
        {
          assetId: 'voice-2',
          endMs: 10_000,
          id: 'clip-voice-2',
          kind: 'voice',
          sceneId: 'scene-2',
          startMs: 4_000,
          voicePreset: 'wenrou-xuejie',
        },
      ],
      id: 'track-voice',
      kind: 'voice',
    },
    {
      clips: [
        // 故意乱序，视图应按时序拼接。
        {
          assetId: 'subtitle-2',
          endMs: 3_500,
          id: 'clip-subtitle-2',
          kind: 'subtitle',
          sceneId: 'scene-1',
          startMs: 2_000,
          text: '第二句',
        },
        {
          assetId: 'subtitle-1',
          endMs: 1_000,
          id: 'clip-subtitle-1',
          kind: 'subtitle',
          sceneId: 'scene-1',
          startMs: 0,
          text: '第一句',
        },
      ],
      id: 'track-subtitle',
      kind: 'subtitle',
      style: { fontSize: 32, presetId: 'classic-white' },
      visible: true,
    },
    { clips: [], id: 'track-music', kind: 'music' },
  ],
};

const DRAFT_PROJECT: StoredProject = {
  assets: { music: [], subtitles: [], thumbnails: [], videos: [], voices: [] },
  canvas: VIDEO_PROJECT.canvas,
  project: {
    contentRevision: 0,
    createdAt: '2026-10-26T09:00:00.000Z',
    name: '草稿工程',
    projectId: 'draft-1',
    updatedAt: NOW,
  },
  render: VIDEO_PROJECT.render,
  scenes: [],
  schemaVersion: '1.0.0',
  tracks: [],
};

function createReader(
  responses: IpcResponse<StoredProject>[],
): ProjectReader & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    async get(projectId) {
      calls.push(projectId);

      return responses[Math.min(calls.length - 1, responses.length - 1)]!;
    },
  };
}

describe('buildEditorProjectView', () => {
  it('exposes metadata, real scene count and cumulative ranges', () => {
    const view = buildEditorProjectView(VIDEO_PROJECT, NOW_MS);

    expect(view.projectId).toBe('project-1');
    expect(view.name).toBe('真实工程');
    expect(view.sceneCount).toBe(2);
    expect(view.totalDurationLabel).toBe('00:10');
    expect(view.updatedLabel).toBe('刚刚更新');
    expect(view.scenes.map((scene) => scene.id)).toEqual(['scene-1', 'scene-2']);
    expect(view.scenes.map((scene) => scene.rangeLabel)).toEqual(['00:00-00:04', '00:04-00:10']);
  });

  it('joins subtitle text in time order and falls back to the scene script', () => {
    const view = buildEditorProjectView(VIDEO_PROJECT, NOW_MS);

    expect(view.scenes[0]?.text).toBe('第一句\n第二句');
    expect(view.scenes[1]?.text).toBe('第二段文稿');
  });

  it('does not let one scene pick up another scene subtitles', () => {
    const view = buildEditorProjectView(VIDEO_PROJECT, NOW_MS);

    expect(view.scenes[1]?.text).not.toContain('第一句');
  });

  it('builds an empty view for a completed project without scenes', () => {
    const view = buildEditorProjectView({ ...VIDEO_PROJECT, scenes: [] }, NOW_MS);

    expect(view.sceneCount).toBe(0);
    expect(view.scenes).toEqual([]);
    expect(view.totalDurationLabel).toBe('00:00');
  });
});

describe('formatUpdatedLabel', () => {
  it('describes recent updates relative to now', () => {
    expect(formatUpdatedLabel(NOW, NOW_MS + 30_000)).toBe('刚刚更新');
    expect(formatUpdatedLabel(NOW, NOW_MS + 5 * 60_000)).toBe('5 分钟前更新');
    expect(formatUpdatedLabel(NOW, NOW_MS + 2 * 60 * 60_000)).toBe('2 小时前更新');
    expect(formatUpdatedLabel(NOW, NOW_MS + 3 * 24 * 60 * 60_000)).toBe('3 天前更新');
  });

  it('never shows a future time as negative', () => {
    expect(formatUpdatedLabel(NOW, NOW_MS - 60_000)).toBe('刚刚更新');
  });

  it('handles an unparsable timestamp', () => {
    expect(formatUpdatedLabel('not-a-date', NOW_MS)).toBe('更新时间未知');
  });
});

describe('loadEditorProject', () => {
  it('loads the completed project through the project reader', async () => {
    const reader = createReader([{ ok: true, data: VIDEO_PROJECT }]);

    const result = await loadEditorProject(reader, 'project-1', NOW_MS);

    expect(reader.calls).toEqual(['project-1']);
    expect(result.kind).toBe('ready');

    if (result.kind === 'ready') {
      expect(result.view.name).toBe('真实工程');
      expect(result.view.sceneCount).toBe(2);
    }
  });

  it('sends draft projects back to the creation conversation', async () => {
    const reader = createReader([{ ok: true, data: DRAFT_PROJECT }]);

    const result = await loadEditorProject(reader, 'draft-1', NOW_MS);

    expect(result).toEqual({ kind: 'draft', projectId: 'draft-1' });
  });

  it('rejects an invalid project id without touching the project store', async () => {
    const reader = createReader([{ ok: true, data: VIDEO_PROJECT }]);

    const result = await loadEditorProject(reader, '../escape', NOW_MS);

    expect(reader.calls).toEqual([]);
    expect(result).toMatchObject({ kind: 'error', code: 'PROJECT_INVALID_ARGUMENT' });
  });

  it.each([
    ['PROJECT_NOT_FOUND', '工程不存在或已被删除。'],
    ['PROJECT_INVALID', '工程文件结构无效，可能已损坏。'],
    ['PROJECT_READ_FAILED', '读取工程失败，请重试。'],
    ['PROJECT_SCHEMA_UNSUPPORTED', '工程版本与当前应用不兼容。'],
  ] as const)('maps %s to a readable error page', async (code, message) => {
    const reader = createReader([
      { error: { code, message: 'internal detail', retryable: false }, ok: false },
    ]);

    const result = await loadEditorProject(reader, 'project-1', NOW_MS);

    expect(result).toEqual({ code, kind: 'error', message });
  });

  it('turns a broken bridge into a load error instead of crashing', async () => {
    const reader: ProjectReader = {
      async get() {
        throw new Error('ipc bridge unavailable');
      },
    };

    const result = await loadEditorProject(reader, 'project-1', NOW_MS);

    expect(result).toEqual({
      code: 'PROJECT_READ_FAILED',
      kind: 'error',
      message: '读取工程失败，请重试。',
    });
  });

  it('reads the latest project every time the editor is entered', async () => {
    const updated: VideoProject = {
      ...VIDEO_PROJECT,
      project: { ...VIDEO_PROJECT.project, name: '更新后的工程', updatedAt: NOW },
    };
    const reader = createReader([
      { ok: true, data: VIDEO_PROJECT },
      { ok: true, data: updated },
    ]);

    const first = await loadEditorProject(reader, 'project-1', NOW_MS);
    const second = await loadEditorProject(reader, 'project-1', NOW_MS);

    expect(first.kind === 'ready' && first.view.name).toBe('真实工程');
    expect(second.kind === 'ready' && second.view.name).toBe('更新后的工程');
  });
});
