import { describe, expect, it } from 'vitest';
import {
  DraftProjectSchema,
  PROJECT_SCHEMA_VERSION,
  StoredProjectSchema,
  VideoProjectSchema,
  type VideoProject,
} from './index';

function createValidProjectInput() {
  return {
    ai: {
      completedAt: '2026-10-23T00:01:00Z',
      inputFingerprint: 'sha256:fixture',
      model: 'claude-sonnet-5-5',
      modelConfigVersion: '1.0.0',
      provider: 'anthropic',
      runId: 'run-1',
      startedAt: '2026-10-23T00:00:00Z',
    },
    assets: {
      music: [
        {
          artist: '测试艺人',
          durationMs: 60_000,
          id: 'asset-music-1',
          path: '/media/music.mp3',
          title: '测试音乐',
        },
      ],
      subtitles: [
        {
          id: 'asset-subtitle-1',
          language: 'zh-CN',
          text: '第一句字幕',
        },
      ],
      thumbnails: [
        {
          height: 432,
          id: 'thumb-1',
          path: '/media/thumb.jpg',
          timeMs: 1_000,
          width: 768,
        },
      ],
      videos: [
        {
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'asset-video-1',
          mediaType: 'video',
          path: '/media/clip.mp4',
          thumbnailIds: ['thumb-1'],
          width: 1920,
        },
        {
          durationMs: 0,
          height: 1080,
          id: 'asset-image-1',
          mediaType: 'image',
          path: '/media/photo.jpg',
          thumbnailIds: [],
          width: 1920,
        },
      ],
      voices: [
        {
          durationMs: 4_000,
          id: 'asset-voice-1',
          isMock: true,
          path: '/generated/voice.wav',
          provider: 'mock-tts',
          voice: 'wenrou',
        },
      ],
    },
    canvas: {
      aspectRatio: '16:9',
      fps: 30,
      height: 1080,
      width: 1920,
    },
    project: {
      contentRevision: 1,
      createdAt: '2026-10-23T00:00:00Z',
      name: '测试工程',
      projectId: 'project-1',
      updatedAt: '2026-10-23T00:02:00Z',
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
        durationMs: 4_000,
        goal: '开场',
        id: 'scene-1',
        index: 1,
        matchedVideoAssetIds: ['asset-video-1'],
        notes: '',
        script: '开场文稿',
        subtitleIds: ['asset-subtitle-1'],
        title: '分镜 01',
        visualIntent: '展示开场画面',
        voiceAssetId: 'asset-voice-1',
      },
    ],
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracks: [
      {
        clips: [
          {
            assetId: 'asset-video-1',
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
        ],
        id: 'track-video',
        kind: 'video',
      },
      {
        clips: [
          {
            assetId: 'asset-voice-1',
            endMs: 4_000,
            id: 'clip-voice-1',
            kind: 'voice',
            sceneId: 'scene-1',
            startMs: 0,
            voicePreset: 'wenrou',
          },
        ],
        id: 'track-voice',
        kind: 'voice',
      },
      {
        clips: [
          {
            assetId: 'asset-subtitle-1',
            endMs: 4_000,
            id: 'clip-subtitle-1',
            kind: 'subtitle',
            sceneId: 'scene-1',
            startMs: 0,
            text: '第一句字幕',
          },
        ],
        id: 'track-subtitle',
        kind: 'subtitle',
        style: { fontSize: 42, presetId: 'white-outline' },
        visible: true,
      },
      {
        clips: [
          {
            assetId: 'asset-music-1',
            endMs: 4_000,
            id: 'clip-music-1',
            kind: 'music',
            loop: false,
            sourceEndMs: 4_000,
            sourceStartMs: 0,
            startMs: 0,
            volume: 0.6,
          },
        ],
        id: 'track-music',
        kind: 'music',
      },
    ],
  };
}

function validProjectFixture(): VideoProject {
  return VideoProjectSchema.parse(createValidProjectInput());
}

describe('VideoProjectSchema', () => {
  it('accepts a complete project and round-trips without defaults', () => {
    const input = createValidProjectInput();
    expect(VideoProjectSchema.parse(input)).toEqual(input);
  });

  it('treats music track visibility as optional and defaults to enabled', () => {
    const omitted = VideoProjectSchema.parse(createValidProjectInput());
    const hiddenInput = createValidProjectInput();
    const hidden = VideoProjectSchema.parse({
      ...hiddenInput,
      tracks: hiddenInput.tracks.map((track) =>
        track.kind === 'music' ? { ...track, visible: false } : track,
      ),
    });
    const omittedMusic = omitted.tracks.find((track) => track.kind === 'music');
    const hiddenMusic = hidden.tracks.find((track) => track.kind === 'music');

    expect(omittedMusic?.kind).toBe('music');
    expect(hiddenMusic?.kind).toBe('music');

    if (omittedMusic?.kind === 'music' && hiddenMusic?.kind === 'music') {
      expect(omittedMusic.visible).toBeUndefined();
      expect(hiddenMusic.visible).toBe(false);
    }
  });

  it('rejects an unknown schema version', () => {
    const input = { ...createValidProjectInput(), schemaVersion: '2.0.0' };
    const result = VideoProjectSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['schemaVersion']);
    }
  });

  it('rejects a clip that does not match its track kind', () => {
    const project = validProjectFixture();
    const voiceClip = project.tracks.find((track) => track.kind === 'voice')?.clips[0];
    if (!voiceClip) {
      throw new Error('fixture is missing the voice clip');
    }

    const input = {
      ...project,
      tracks: project.tracks.map((track) =>
        track.kind === 'video' ? { ...track, clips: [voiceClip] } : track,
      ),
    };

    expect(VideoProjectSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-positive clip durations', () => {
    const project = validProjectFixture();
    const videoTrack = project.tracks.find((track) => track.kind === 'video');
    const clip = videoTrack?.clips[0];
    if (!clip) {
      throw new Error('fixture is missing the video clip');
    }

    clip.endMs = clip.startMs;
    expect(VideoProjectSchema.safeParse(project).success).toBe(false);
  });

  it('rejects non-positive source ranges', () => {
    const project = validProjectFixture();
    const videoTrack = project.tracks.find((track) => track.kind === 'video');
    const clip = videoTrack?.clips[0];
    if (!clip) {
      throw new Error('fixture is missing the video clip');
    }

    clip.sourceEndMs = clip.sourceStartMs;
    expect(VideoProjectSchema.safeParse(project).success).toBe(false);

    const musicProject = validProjectFixture();
    const musicTrack = musicProject.tracks.find((track) => track.kind === 'music');
    const musicClip = musicTrack?.clips[0];
    if (!musicClip) {
      throw new Error('fixture is missing the music clip');
    }

    musicClip.sourceEndMs = musicClip.sourceStartMs;
    expect(VideoProjectSchema.safeParse(musicProject).success).toBe(false);
  });

  it('rejects negative timeline positions', () => {
    const project = validProjectFixture();
    const videoTrack = project.tracks.find((track) => track.kind === 'video');
    const clip = videoTrack?.clips[0];
    if (!clip) {
      throw new Error('fixture is missing the video clip');
    }

    clip.startMs = -1;
    expect(VideoProjectSchema.safeParse(project).success).toBe(false);
  });

  it('rejects invalid asset dimensions, volumes, speeds, and crops', () => {
    const zeroWidth = validProjectFixture();
    zeroWidth.assets.videos[0]!.width = 0;
    expect(VideoProjectSchema.safeParse(zeroWidth).success).toBe(false);

    const loudVoice = validProjectFixture();
    const voiceTrack = loudVoice.tracks.find((track) => track.kind === 'voice');
    if (!voiceTrack) {
      throw new Error('fixture is missing the voice track');
    }
    voiceTrack.clips[0]!.volume = 1.1;
    expect(VideoProjectSchema.safeParse(loudVoice).success).toBe(false);

    const slowVideo = validProjectFixture();
    const videoTrack = slowVideo.tracks.find((track) => track.kind === 'video');
    if (!videoTrack) {
      throw new Error('fixture is missing the video track');
    }
    videoTrack.clips[0]!.speed = 0.4;
    expect(VideoProjectSchema.safeParse(slowVideo).success).toBe(false);

    const outOfBoundsCrop = validProjectFixture();
    const cropTrack = outOfBoundsCrop.tracks.find((track) => track.kind === 'video');
    if (!cropTrack) {
      throw new Error('fixture is missing the video track');
    }
    cropTrack.clips[0]!.crop = { height: 1, width: 0.6, x: 0.5, y: 0 };
    expect(VideoProjectSchema.safeParse(outOfBoundsCrop).success).toBe(false);
  });

  it('requires fps for video assets but not for image assets', () => {
    const withoutVideoFps = validProjectFixture();
    const videoAsset = withoutVideoFps.assets.videos.find((asset) => asset.mediaType === 'video');
    if (!videoAsset) {
      throw new Error('fixture is missing the video asset');
    }

    delete videoAsset.fps;
    const result = VideoProjectSchema.safeParse(withoutVideoFps);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['assets', 'videos', 0, 'fps']);
    }

    const withImageAsset = validProjectFixture();
    const imageAsset = withImageAsset.assets.videos.find((asset) => asset.mediaType === 'image');
    expect(imageAsset?.fps).toBeUndefined();
    expect(VideoProjectSchema.safeParse(withImageAsset).success).toBe(true);
  });

  it('validates subtitle style boundaries', () => {
    const minimum = validProjectFixture();
    const minimumTrack = minimum.tracks.find((track) => track.kind === 'subtitle');
    if (!minimumTrack) {
      throw new Error('fixture is missing the subtitle track');
    }
    minimumTrack.style.fontSize = 24;
    expect(VideoProjectSchema.safeParse(minimum).success).toBe(true);

    const maximum = validProjectFixture();
    const maximumTrack = maximum.tracks.find((track) => track.kind === 'subtitle');
    if (!maximumTrack) {
      throw new Error('fixture is missing the subtitle track');
    }
    maximumTrack.style.fontSize = 72;
    expect(VideoProjectSchema.safeParse(maximum).success).toBe(true);

    const tooSmall = validProjectFixture();
    const tooSmallTrack = tooSmall.tracks.find((track) => track.kind === 'subtitle');
    if (!tooSmallTrack) {
      throw new Error('fixture is missing the subtitle track');
    }
    tooSmallTrack.style.fontSize = 23;
    expect(VideoProjectSchema.safeParse(tooSmall).success).toBe(false);

    const tooLarge = validProjectFixture();
    const tooLargeTrack = tooLarge.tracks.find((track) => track.kind === 'subtitle');
    if (!tooLargeTrack) {
      throw new Error('fixture is missing the subtitle track');
    }
    tooLargeTrack.style.fontSize = 73;
    expect(VideoProjectSchema.safeParse(tooLarge).success).toBe(false);

    const unknownPreset = validProjectFixture();
    const unknownPresetInput = {
      ...unknownPreset,
      tracks: unknownPreset.tracks.map((track) =>
        track.kind === 'subtitle'
          ? { ...track, style: { ...track.style, presetId: 'neon' } }
          : track,
      ),
    };
    expect(VideoProjectSchema.safeParse(unknownPresetInput).success).toBe(false);
  });

  it('reports the path of a missing scene voice asset', () => {
    const project = validProjectFixture();
    const { voiceAssetId: _voiceAssetId, ...scene } = project.scenes[0]!;
    const input = { ...project, scenes: [scene] };
    const result = VideoProjectSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['scenes', 0, 'voiceAssetId']);
    }
  });
});

describe('StoredProjectSchema', () => {
  it('accepts a draft without ai', () => {
    const { ai: _ai, ...draft } = validProjectFixture();

    expect(DraftProjectSchema.safeParse(draft).success).toBe(true);
    expect(StoredProjectSchema.safeParse(draft).success).toBe(true);
  });

  it('accepts a completed video project', () => {
    expect(StoredProjectSchema.safeParse(validProjectFixture()).success).toBe(true);
  });

  it('requires schemaVersion', () => {
    const { ai: _ai, schemaVersion: _schemaVersion, ...draft } = validProjectFixture();

    expect(DraftProjectSchema.safeParse(draft).success).toBe(false);
    expect(StoredProjectSchema.safeParse(draft).success).toBe(false);
  });

  it('rejects an unsupported schemaVersion', () => {
    const { ai: _ai, ...draft } = validProjectFixture();

    expect(DraftProjectSchema.safeParse({ ...draft, schemaVersion: '2.0.0' }).success).toBe(false);
    expect(StoredProjectSchema.safeParse({ ...draft, schemaVersion: '2.0.0' }).success).toBe(false);
  });
});
