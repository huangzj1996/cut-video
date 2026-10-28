import { describe, expect, it } from 'vitest';
import type { VideoProject } from '@miaoma/video-project';
import { alignMediaElement, syncAudioElement } from './media-sync';
import {
  audioReachedSourceEnd,
  buildPreviewMediaPlan,
  describeMediaElementError,
  describeVideoIssue,
  findClipAtSeconds,
  resolveMusicSourceSeconds,
  resolveVideoSourceSeconds,
  resolveVoiceSourceSeconds,
  trackHasClips,
} from './preview-media';

function makeProject(): VideoProject {
  return {
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
          durationMs: 8_000,
          id: 'music-1',
          path: '/media/song.mp3',
          title: 'Eutopia',
        },
      ],
      subtitles: [],
      thumbnails: [],
      videos: [
        {
          codec: 'h264',
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'video-1',
          mediaType: 'video',
          path: '/media/source.mp4',
          thumbnailIds: [],
          width: 1920,
        },
        {
          codec: 'h264',
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'video-2',
          mediaType: 'video',
          path: '/media/second.mov',
          thumbnailIds: [],
          width: 1920,
        },
        {
          codec: 'hevc',
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'video-hevc',
          mediaType: 'video',
          path: '/media/hevc.mp4',
          thumbnailIds: [],
          width: 1920,
        },
        {
          codec: 'h264',
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'video-hdr',
          isHdr: true,
          mediaType: 'video',
          path: '/media/hdr.mp4',
          thumbnailIds: [],
          width: 1920,
        },
        {
          codec: 'h264',
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'video-vfr',
          isVfr: true,
          mediaType: 'video',
          path: '/media/vfr.mp4',
          thumbnailIds: [],
          width: 1920,
        },
        {
          codec: 'vp9',
          durationMs: 10_000,
          fps: 30,
          height: 1080,
          id: 'video-webm',
          mediaType: 'video',
          path: '/media/clip.webm',
          thumbnailIds: [],
          width: 1920,
        },
        {
          durationMs: 10_000,
          height: 1080,
          id: 'image-1',
          mediaType: 'image',
          path: '/media/still.png',
          thumbnailIds: [],
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
      ],
    },
    canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
    project: {
      contentRevision: 2,
      createdAt: '2026-10-26T09:00:00.000Z',
      name: '预览工程',
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
        script: '第一段',
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
        script: '第二段',
        subtitleIds: [],
        title: '收尾',
        visualIntent: '街景',
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
            sourceEndMs: 10_000,
            sourceStartMs: 2_000,
            speed: 2,
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
        ],
        id: 'track-voice',
        kind: 'voice',
      },
      {
        clips: [],
        id: 'track-subtitle',
        kind: 'subtitle',
        style: { fontSize: 32, presetId: 'classic-white' },
        visible: true,
      },
      {
        clips: [
          {
            assetId: 'music-1',
            endMs: 10_000,
            id: 'clip-music-1',
            kind: 'music',
            loop: true,
            sourceEndMs: 9_000,
            sourceStartMs: 5_000,
            startMs: 0,
          },
        ],
        id: 'track-music',
        kind: 'music',
      },
    ],
  };
}

interface FakeMediaElement {
  currentTime: number;
  dataset: Record<string, string | undefined>;
  muted: boolean;
  paused: boolean;
  playbackRate: number;
  src: string;
  volume: number;
  load: () => undefined;
  pause: () => void;
  play: () => Promise<void>;
  removeAttribute: () => undefined;
}

/** 预览层用到的媒体元素属性集合；假元素让三类媒体可以被一起断言。 */
function createFakeMediaElement(
  currentTime: number,
  loadedAssetId: string,
  paused = true,
): FakeMediaElement {
  return {
    currentTime,
    dataset: { assetId: loadedAssetId },
    load: () => undefined,
    muted: false,
    pause() {
      this.paused = true;
    },
    paused,
    play() {
      this.paused = false;

      return Promise.resolve();
    },
    playbackRate: 1,
    removeAttribute: () => undefined,
    src: `asset://project-1/${loadedAssetId}`,
    volume: 1,
  };
}

function withVideoAsset(project: VideoProject, assetId: string): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.kind === 'video'
        ? {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === 'clip-video-2' ? { ...clip, assetId } : clip,
            ),
          }
        : track,
    ),
  };
}

describe('buildPreviewMediaPlan video', () => {
  it('maps the active clip to source time, including speed and source offset', () => {
    const plan = buildPreviewMediaPlan(makeProject(), 1);

    expect(plan.video).toMatchObject({
      assetId: 'video-1',
      clipId: 'clip-video-1',
      mediaType: 'video',
      playbackRate: 2,
      sourceSeconds: 4,
    });
    expect(plan.videoIssue).toBeNull();
  });

  it('finds clips at boundaries and keeps the last frame at the project end', () => {
    const project = makeProject();

    expect(buildPreviewMediaPlan(project, 3.999).video?.clipId).toBe('clip-video-1');
    expect(buildPreviewMediaPlan(project, 4).video?.clipId).toBe('clip-video-2');
    expect(buildPreviewMediaPlan(project, 10).video?.clipId).toBe('clip-video-2');
    expect(buildPreviewMediaPlan(project, 10.01).video).toBeNull();
  });

  it('exposes the next clip for preloading and stops at the last clip', () => {
    const project = makeProject();

    expect(buildPreviewMediaPlan(project, 1).nextVideo?.clipId).toBe('clip-video-2');
    expect(buildPreviewMediaPlan(project, 5).nextVideo).toBeNull();
  });

  it('does not preload a next clip that cannot be played directly', () => {
    const plan = buildPreviewMediaPlan(withVideoAsset(makeProject(), 'video-hevc'), 1);

    // 当前 H.264 片段照常播放，但不把 HEVC 片段塞进预加载槽位。
    expect(plan.video).toMatchObject({ clipId: 'clip-video-1' });
    expect(plan.videoIssue).toBeNull();
    expect(plan.nextVideo).toBeNull();
  });

  it('treats image clips as static media with no source offset', () => {
    const plan = buildPreviewMediaPlan(withVideoAsset(makeProject(), 'image-1'), 5);

    expect(plan.video).toMatchObject({
      assetId: 'image-1',
      mediaType: 'image',
      playbackRate: 1,
      sourceSeconds: 0,
    });
  });

  it('reports a missing asset instead of silently showing black', () => {
    const plan = buildPreviewMediaPlan(withVideoAsset(makeProject(), 'missing-video'), 5);

    expect(plan.video).toBeNull();
    expect(plan.videoIssue).toMatchObject({ kind: 'missing-asset' });
  });
});

describe('describeVideoIssue', () => {
  const [h264, mov, hevc, hdr, vfr, webm] = makeProject().assets.videos;

  it('plays H.264 MP4/MOV directly', () => {
    expect(describeVideoIssue(h264!)).toBeNull();
    expect(describeVideoIssue(mov!)).toBeNull();
  });

  it('plays sources recorded before the codec field existed', () => {
    const { codec: _codec, ...legacyH264 } = h264!;

    expect(describeVideoIssue(legacyH264)).toBeNull();
  });

  it('accepts codec aliases and case-insensitive container extensions', () => {
    expect(describeVideoIssue({ ...h264!, codec: 'avc' })).toBeNull();
    expect(describeVideoIssue({ ...h264!, codec: 'avc1' })).toBeNull();
    expect(describeVideoIssue({ ...h264!, codec: 'AVC' })).toBeNull();
    expect(describeVideoIssue({ ...h264!, path: '/media/clip.m4v' })).toBeNull();
    expect(describeVideoIssue({ ...mov!, path: '/media/second.MOV' })).toBeNull();
  });

  it('explains unsupported codecs, HDR, VFR, and containers', () => {
    expect(describeVideoIssue(hevc!)).toMatchObject({ kind: 'unsupported-codec' });
    expect(describeVideoIssue(hdr!)).toMatchObject({ kind: 'unsupported-hdr' });
    expect(describeVideoIssue(vfr!)).toMatchObject({ kind: 'unsupported-vfr' });
    expect(describeVideoIssue(webm!)).toMatchObject({ kind: 'unsupported-container' });
  });

  it('surfaces the reason on the active clip plan', () => {
    const plan = buildPreviewMediaPlan(withVideoAsset(makeProject(), 'video-hevc'), 5);

    expect(plan.video).toBeNull();
    expect(plan.videoIssue).toMatchObject({
      kind: 'unsupported-codec',
      message: expect.stringContaining('H.264'),
    });
  });
});

describe('describeMediaElementError', () => {
  it('explains unsupported sources and decode failures', () => {
    expect(describeMediaElementError({ code: 4 })).toContain('不受支持');
    expect(describeMediaElementError({ code: 3 })).toContain('解码失败');
    expect(describeMediaElementError({ code: 2 })).toContain('加载中断');
    expect(describeMediaElementError(null)).toBe('媒体加载失败。');
  });
});

describe('preview source mapping', () => {
  const project = makeProject();
  const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
  const videoClip = videoTrack.clips[0]!;
  const voiceClip = project.tracks.find((track) => track.kind === 'voice')!.clips[0]!;
  const musicClip = project.tracks.find((track) => track.kind === 'music')!.clips[0]!;
  const voiceAsset = project.assets.voices[0]!;

  it('maps video timeline time through speed and the source offset', () => {
    expect(resolveVideoSourceSeconds(videoClip, 1)).toBe(4);
    expect(resolveVideoSourceSeconds(videoClip, 0)).toBe(2);
  });

  it('holds the last source frame instead of seeking to the very end', () => {
    expect(resolveVideoSourceSeconds(videoClip, 999)).toBe(9.999);
  });

  it('maps voice source time through speed and clamps at the asset duration', () => {
    expect(resolveVoiceSourceSeconds({ ...voiceClip, speed: 2 }, voiceAsset, 1)).toBe(2);
    expect(resolveVoiceSourceSeconds(voiceClip, voiceAsset, 999)).toBe(4);
  });

  it('wraps looping music and clamps non-looping music at the source end', () => {
    expect(resolveMusicSourceSeconds(musicClip, 5)).toBe(6);
    expect(resolveMusicSourceSeconds({ ...musicClip, loop: false }, 8)).toBe(9);
  });

  it('finds the clip at an exact boundary and keeps the last frame at the project end', () => {
    expect(findClipAtSeconds(videoTrack.clips, 4)?.id).toBe('clip-video-2');
    expect(findClipAtSeconds(videoTrack.clips, 10)?.id).toBe('clip-video-2');
    expect(findClipAtSeconds(videoTrack.clips, 10.001)).toBeUndefined();
  });
});

describe('buildPreviewMediaPlan audio', () => {
  it('aligns voice to the clip start and marks mock assets', () => {
    const plan = buildPreviewMediaPlan(makeProject(), 1.5);

    expect(plan.voice).toMatchObject({
      assetId: 'voice-1',
      isMock: true,
      playbackRate: 1,
      sourceSeconds: 1.5,
    });
    expect(plan.audioIssues).toEqual([]);
  });

  it('returns no voice element outside the voice track', () => {
    expect(buildPreviewMediaPlan(makeProject(), 6).voice).toBeNull();
  });

  it('wraps looping music inside its trimmed source range', () => {
    const project = makeProject();

    expect(buildPreviewMediaPlan(project, 1).music?.sourceSeconds).toBe(6);
    // 源区间 5s-9s 共 4s：第 5 秒回到 6s，第 8 秒回到 5s。
    expect(buildPreviewMediaPlan(project, 5).music?.sourceSeconds).toBe(6);
    expect(buildPreviewMediaPlan(project, 8).music?.sourceSeconds).toBe(5);
  });

  it('clamps non-looping music at the source end', () => {
    const project = makeProject();

    project.tracks = project.tracks.map((track) =>
      track.kind === 'music'
        ? {
            ...track,
            clips: track.clips.map((clip) => ({ ...clip, loop: false })),
          }
        : track,
    );

    expect(buildPreviewMediaPlan(project, 5).music?.sourceSeconds).toBe(9);
  });

  it('does not create a music plan when the music track is empty', () => {
    const project = makeProject();

    project.tracks = project.tracks.map((track) =>
      track.kind === 'music' ? { ...track, clips: [] } : track,
    );

    expect(buildPreviewMediaPlan(project, 1).music).toBeNull();
  });

  it('stops non-looping audio at its trimmed source end', () => {
    const project = makeProject();

    project.tracks = project.tracks.map((track) =>
      track.kind === 'music'
        ? {
            ...track,
            clips: track.clips.map((clip) => ({ ...clip, loop: false })),
          }
        : track,
    );

    const plan = buildPreviewMediaPlan(project, 5).music!;

    expect(audioReachedSourceEnd(plan)).toBe(true);
    expect(audioReachedSourceEnd({ ...plan, loop: true })).toBe(false);
  });

  it('reports missing voice assets as an audio issue', () => {
    const project = makeProject();

    project.assets = { ...project.assets, voices: [] };

    const plan = buildPreviewMediaPlan(project, 1);

    expect(plan.voice).toBeNull();
    expect(plan.audioIssues).toEqual([
      expect.objectContaining({ kind: 'missing-asset', assetId: 'voice-1' }),
    ]);
  });
});

describe('trackHasClips', () => {
  it('reports the voice and music tracks that carry clips', () => {
    const project = makeProject();

    expect(trackHasClips(project, 'voice')).toBe(true);
    expect(trackHasClips(project, 'music')).toBe(true);
  });

  it('reports an empty music track so the preview mounts no audio element', () => {
    const project = makeProject();

    project.tracks = project.tracks.map((track) =>
      track.kind === 'music' ? { ...track, clips: [] } : track,
    );

    expect(trackHasClips(project, 'music')).toBe(false);
  });

  it('reports a missing voice track without affecting the music track', () => {
    const project = makeProject();

    project.tracks = project.tracks.filter((track) => track.kind !== 'voice');

    expect(trackHasClips(project, 'voice')).toBe(false);
    expect(trackHasClips(project, 'music')).toBe(true);
  });
});

describe('preview seek alignment', () => {
  it('lands video, voice, and music on their mapped source times from one paused seek', () => {
    const plan = buildPreviewMediaPlan(makeProject(), 2);

    // 三类媒体都在播放，模拟播放中暂停后的一次统一 seek。
    const videoPlan = plan.video!;
    const video = createFakeMediaElement(0, 'video-1', false);
    const voice = createFakeMediaElement(0, 'voice-1', false);
    const music = createFakeMediaElement(0, 'music-1', false);

    // 与 PreviewStage 相同：活动视频先应用倍速，再对齐 source 时间。
    video.playbackRate = videoPlan.playbackRate;
    alignMediaElement(video as unknown as HTMLMediaElement, videoPlan.sourceSeconds, false);
    syncAudioElement(voice as unknown as HTMLAudioElement, plan.voice, 'project-1', false, false);
    syncAudioElement(music as unknown as HTMLAudioElement, plan.music, 'project-1', false, false);

    // 时间线 2s 的独立换算：视频从素材 2s 起以 2x 播放 → 6s；
    // 配音片段从起点播放 → 2s；音乐源区间从 5s 起且有 2s 偏移 → 7s。
    expect([video.currentTime, voice.currentTime, music.currentTime]).toEqual([6, 2, 7]);
    expect([video.paused, voice.paused, music.paused]).toEqual([true, true, true]);
    expect(video.playbackRate).toBe(2);
  });
});
