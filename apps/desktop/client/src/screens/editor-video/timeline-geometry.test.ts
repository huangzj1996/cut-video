import { describe, expect, it } from 'vitest';
import type { VideoProject } from '@miaoma/video-project';
import {
  buildEditorTimeline,
  buildTimelineTicks,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  projectDurationSeconds,
  sliderFromZoom,
  zoomFromSlider,
} from './timeline-geometry';

const PROJECT: VideoProject = {
  ai: {
    completedAt: '2026-10-27T10:00:00.000Z',
    inputFingerprint: 'fingerprint',
    model: 'deepseek-chat',
    modelConfigVersion: 'v1',
    provider: 'deepseek',
    runId: 'run-1',
    startedAt: '2026-10-27T10:00:00.000Z',
  },
  assets: {
    music: [
      {
        artist: 'Mika Chen',
        durationMs: 60_000,
        id: 'music-1',
        path: '/media/song.mp3',
        title: 'Eutopia',
      },
    ],
    subtitles: [],
    thumbnails: [
      { height: 432, id: 'thumb-1', path: '/a.jpg', timeMs: 0, width: 768 },
      { height: 432, id: 'thumb-2', path: '/b.jpg', timeMs: 1_000, width: 768 },
    ],
    videos: [
      {
        durationMs: 10_000,
        fps: 30,
        height: 1080,
        id: 'video-1',
        mediaType: 'video',
        path: '/media/source.mp4',
        thumbnailIds: ['thumb-1', 'thumb-2'],
        width: 1920,
      },
      {
        durationMs: 10_000,
        fps: 30,
        height: 1080,
        id: 'video-2',
        mediaType: 'video',
        path: '/media/second.mp4',
        thumbnailIds: ['missing-thumb'],
        width: 1920,
      },
    ],
    voices: [
      {
        durationMs: 4_000,
        id: 'voice-1',
        isMock: true,
        path: '/media/voice-1.wav',
        provider: 'mock',
        voice: 'wenrou-xuejie',
      },
      {
        durationMs: 6_000,
        id: 'voice-2',
        isMock: true,
        path: '/media/voice-2.wav',
        provider: 'mock',
        voice: 'wenrou-xuejie',
      },
    ],
  },
  canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
  project: {
    contentRevision: 2,
    createdAt: '2026-10-26T09:00:00.000Z',
    name: '真实工程',
    projectId: 'project-1',
    updatedAt: '2026-10-27T10:00:00.000Z',
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
      matchedVideoAssetIds: ['video-1'],
      notes: '',
      script: '第一段文稿',
      subtitleIds: [],
      title: '开场',
      visualIntent: '办公室',
      voiceAssetId: 'voice-1',
    },
    {
      durationMs: 6_000,
      goal: '收尾',
      id: 'scene-2',
      index: 2,
      matchedVideoAssetIds: ['video-2'],
      notes: '',
      script: '第二段文稿',
      subtitleIds: [],
      title: '收尾',
      visualIntent: '街景',
      voiceAssetId: 'voice-2',
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
          assetId: 'video-2',
          crop: { height: 1, width: 1, x: 0, y: 0 },
          endMs: 10_000,
          id: 'clip-video-2',
          kind: 'video',
          sceneId: 'scene-2',
          sourceEndMs: 6_000,
          sourceStartMs: 0,
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
        {
          assetId: 'subtitle-2',
          endMs: 3_500,
          id: 'clip-subtitle-2',
          kind: 'subtitle',
          sceneId: 'scene-1',
          startMs: 2_000,
          text: '第二句字幕',
        },
        {
          assetId: 'subtitle-1',
          endMs: 1_000,
          id: 'clip-subtitle-1',
          kind: 'subtitle',
          sceneId: 'scene-1',
          startMs: 0,
          text: '第一句字幕',
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

describe('projectDurationSeconds', () => {
  it('uses the sum of real scene durations', () => {
    expect(projectDurationSeconds(PROJECT)).toBe(10);
  });

  it('falls back to the furthest clip when there are no scenes', () => {
    const noScenes: VideoProject = { ...PROJECT, scenes: [] };

    expect(projectDurationSeconds(noScenes)).toBe(10);
  });

  it('returns zero for an empty project', () => {
    expect(projectDurationSeconds({ ...PROJECT, scenes: [], tracks: [] })).toBe(0);
  });
});

describe('buildTimelineTicks', () => {
  it('generates a label every ten seconds for a short project plus the end', () => {
    const ticks = buildTimelineTicks(87);

    expect(ticks.slice(0, 3)).toEqual([
      { label: '00:00', seconds: 0 },
      { label: '00:10', seconds: 10 },
      { label: '00:20', seconds: 20 },
    ]);
    expect(ticks.at(-1)).toEqual({ label: '01:27', seconds: 87 });
  });

  it('adapts the step to long projects', () => {
    const ticks = buildTimelineTicks(600);

    expect(ticks[1]?.seconds).toBe(60);
    expect(ticks.at(-1)?.seconds).toBe(600);
  });

  it('keeps a single zero tick for an empty project', () => {
    expect(buildTimelineTicks(0)).toEqual([{ label: '00:00', seconds: 0 }]);
  });
});

describe('buildEditorTimeline', () => {
  const timeline = buildEditorTimeline(PROJECT);

  it('builds the four tracks in video, voice, subtitle, music order', () => {
    expect(timeline.tracks.map((track) => track.kind)).toEqual([
      'video',
      'voice',
      'subtitle',
      'music',
    ]);
  });

  it('shows real counts and treats an empty music track as an empty state', () => {
    expect(timeline.tracks.map((track) => track.countLabel)).toEqual([
      '2 个分镜',
      '2 段配音',
      '2 条字幕',
      '未添加音乐',
    ]);
  });

  it('converts clip milliseconds to seconds and keeps scene references', () => {
    const video = timeline.tracks[0]!;

    expect(video.clips.map((clip) => clip.id)).toEqual(['clip-video-1', 'clip-video-2']);
    expect(video.clips.map((clip) => [clip.startSeconds, clip.endSeconds])).toEqual([
      [0, 4],
      [4, 10],
    ]);
    expect(video.clips.map((clip) => clip.sceneId)).toEqual(['scene-1', 'scene-2']);
  });

  it('attaches only registered keyframe thumbnails to video clips', () => {
    const video = timeline.tracks[0]!;

    expect(video.clips[0]?.thumbnailIds).toEqual(['thumb-1', 'thumb-2']);
    expect(video.clips[1]?.thumbnailIds).toEqual([]);
  });

  it('marks mock voice clips and sorts subtitle text in time order', () => {
    const voice = timeline.tracks[1]!;
    const subtitle = timeline.tracks[2]!;

    expect(voice.clips.map((clip) => clip.badge)).toEqual(['模拟', '模拟']);
    expect(subtitle.clips.map((clip) => clip.text)).toEqual(['第一句字幕', '第二句字幕']);
  });

  it('carries music metadata when the track has clips', () => {
    const withMusic = buildEditorTimeline({
      ...PROJECT,
      tracks: PROJECT.tracks.map((track) =>
        track.kind === 'music'
          ? {
              ...track,
              clips: [
                {
                  assetId: 'music-1',
                  endMs: 6_000,
                  id: 'clip-music-1',
                  kind: 'music' as const,
                  startMs: 0,
                  sourceEndMs: 6_000,
                  sourceStartMs: 0,
                },
              ],
            }
          : track,
      ),
    });
    const music = withMusic.tracks[3]!;

    expect(music.countLabel).toBe('1 段音乐');
    expect(music.clips[0]).toMatchObject({
      artist: 'Mika Chen',
      endSeconds: 6,
      label: 'Eutopia',
      startSeconds: 0,
    });
  });

  it('includes dynamic ruler ticks for the project duration', () => {
    expect(timeline.durationSeconds).toBe(10);
    expect(timeline.ticks.at(-1)).toEqual({ label: '00:10', seconds: 10 });
  });
});

describe('zoom helpers', () => {
  it('clamps zoom to the supported 1x-8x range', () => {
    expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(12)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
  });

  it('maps the slider to zoom and back', () => {
    expect(zoomFromSlider(0)).toBe(1);
    expect(zoomFromSlider(100)).toBe(8);
    expect(zoomFromSlider(50)).toBeCloseTo(4.5, 5);
    expect(sliderFromZoom(8)).toBe(100);
    expect(sliderFromZoom(1)).toBe(0);
  });
});
