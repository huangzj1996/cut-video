import type {
  SubtitleClip,
  SubtitlePresetId,
  VideoClip,
  VideoProject,
  VoiceClip,
} from '@miaoma/video-project';

const ISO = '2026-01-01T00:00:00.000Z';

/** 单测里代表随包字体的位置；真实路径由 resolveExportFonts 解析，单测不需要磁盘。 */
export const EXPORT_TEST_FONTS = {
  directory: 'C:/app/resources/fonts',
  files: ['C:/app/resources/fonts/NotoSansSC-Regular.otf'],
};

export interface ExportFixtureSubtitleOptions {
  endMs?: number;
  fontSize?: number;
  presetId?: SubtitlePresetId;
  startMs?: number;
  text?: string;
  visible?: boolean;
}

export interface ExportFixtureOptions {
  audioPath?: string;
  firstMediaType?: 'image' | 'video';
  speed?: number;
  subtitle?: ExportFixtureSubtitleOptions;
  videoPaths?: readonly [string, string];
}

function videoClip(
  id: string,
  assetId: string,
  startMs: number,
  endMs: number,
  sceneId: string,
  speed?: number,
): VideoClip {
  return {
    assetId,
    crop: { height: 1, width: 1, x: 0, y: 0 },
    endMs,
    id,
    kind: 'video',
    sceneId,
    sourceEndMs: endMs - startMs,
    sourceStartMs: 0,
    startMs,
    ...(speed !== undefined ? { speed } : {}),
    transform: { scale: 1, x: 0, y: 0 },
  };
}

function voiceClip(id: string, startMs: number, endMs: number, sceneId: string): VoiceClip {
  return {
    assetId: 'voice-a',
    endMs,
    id,
    kind: 'voice',
    sceneId,
    startMs,
    voicePreset: 'wenrou-xuejie',
  };
}

function subtitleClip(options: ExportFixtureSubtitleOptions): SubtitleClip {
  return {
    assetId: 'subtitle-a',
    endMs: options.endMs ?? 2_000,
    id: 'subtitle-1',
    kind: 'subtitle',
    sceneId: 'scene-1',
    startMs: options.startMs ?? 0,
    text: options.text ?? '第一句字幕',
  };
}

/** 两段各 1 秒的夹具工程：视频轨、配音轨都覆盖完整时间线，可过业务校验。 */
export function createExportFixture(options: ExportFixtureOptions = {}): VideoProject {
  const [firstPath, secondPath] = options.videoPaths ?? ['C:/media/a.mp4', 'C:/media/b.mp4'];
  const audioPath = options.audioPath ?? 'C:/media/voice.m4a';
  const firstType = options.firstMediaType ?? 'video';
  const subtitle = options.subtitle;
  const tracks: VideoProject['tracks'] = [
    {
      clips: [
        videoClip('clip-1', 'video-a', 0, 1_000, 'scene-1', options.speed),
        videoClip('clip-2', 'video-b', 1_000, 2_000, 'scene-2', options.speed),
      ],
      id: 'track-video',
      kind: 'video',
    },
    {
      clips: [
        voiceClip('voice-1', 0, 1_000, 'scene-1'),
        voiceClip('voice-2', 1_000, 2_000, 'scene-2'),
      ],
      id: 'track-voice',
      kind: 'voice',
    },
  ];

  if (subtitle) {
    tracks.push({
      clips: [subtitleClip(subtitle)],
      id: 'track-subtitle',
      kind: 'subtitle',
      style: {
        fontSize: subtitle.fontSize ?? 42,
        presetId: subtitle.presetId ?? 'white-outline',
      },
      visible: subtitle.visible ?? true,
    });
  }

  return {
    ai: {
      completedAt: ISO,
      inputFingerprint: 'fixture',
      model: 'fixture-model',
      modelConfigVersion: '1',
      provider: 'fixture',
      runId: 'run-1',
      startedAt: ISO,
    },
    assets: {
      music: [],
      subtitles: subtitle ? [{ id: 'subtitle-a', text: subtitle.text ?? '第一句字幕' }] : [],
      thumbnails: [],
      videos: [
        {
          ...(firstType === 'video' ? { fps: 30 } : {}),
          durationMs: 5_000,
          height: 1080,
          id: 'video-a',
          mediaType: firstType,
          path: firstPath,
          thumbnailIds: [],
          width: 1920,
        },
        {
          durationMs: 5_000,
          fps: 30,
          height: 1080,
          id: 'video-b',
          mediaType: 'video',
          path: secondPath,
          thumbnailIds: [],
          width: 1920,
        },
      ],
      voices: [
        {
          durationMs: 2_000,
          id: 'voice-a',
          isMock: true,
          path: audioPath,
          provider: 'fixture',
          voice: 'fixture',
        },
      ],
    },
    canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
    project: {
      contentRevision: 1,
      createdAt: ISO,
      name: '夹具工程',
      projectId: 'project-fixture',
      updatedAt: ISO,
    },
    render: {
      audioBitrateKbps: 192,
      audioCodec: 'aac',
      burnSubtitles: true,
      container: 'mp4',
      sourceAudioMuted: true,
      videoCodec: 'h264',
    },
    scenes: [
      {
        durationMs: 1_000,
        goal: '开场',
        id: 'scene-1',
        index: 1,
        matchedVideoAssetIds: ['video-a'],
        notes: '',
        script: '第一段',
        subtitleIds: subtitle ? ['subtitle-a'] : [],
        title: '开场',
        visualIntent: '画面',
        voiceAssetId: 'voice-a',
      },
      {
        durationMs: 1_000,
        goal: '主体',
        id: 'scene-2',
        index: 2,
        matchedVideoAssetIds: ['video-b'],
        notes: '',
        script: '第二段',
        subtitleIds: [],
        title: '主体',
        visualIntent: '画面',
        voiceAssetId: 'voice-a',
      },
    ],
    schemaVersion: '1.0.0',
    tracks,
  };
}
