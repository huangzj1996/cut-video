import { describe, expect, it } from 'vitest';
import type { SubtitleClip, SubtitleTrack, VideoProject } from '@miaoma/video-project';
import { isRenderableSubtitleClip, shouldBurnSubtitles } from './subtitle-burn';

type SubtitleProject = Pick<VideoProject, 'render' | 'tracks'>;

const RENDER: SubtitleProject['render'] = {
  audioBitrateKbps: 192,
  audioCodec: 'aac',
  burnSubtitles: true,
  container: 'mp4',
  sourceAudioMuted: true,
  videoCodec: 'h264',
};

function clip(overrides: Partial<SubtitleClip> = {}): SubtitleClip {
  return {
    assetId: 'sub-1',
    endMs: 1_000,
    id: 'clip-sub-1',
    kind: 'subtitle',
    sceneId: 'scene-1',
    startMs: 0,
    text: '第一句',
    ...overrides,
  };
}

function project(
  options: { burnSubtitles?: boolean; clips?: SubtitleClip[]; visible?: boolean } = {},
): SubtitleProject {
  const track: SubtitleTrack = {
    clips: options.clips ?? [clip()],
    id: 'track-subtitle',
    kind: 'subtitle',
    style: { fontSize: 32, presetId: 'classic-white' },
    visible: options.visible ?? true,
  };

  return {
    // v1 的 schema 把 burnSubtitles 固定为 true；这里显式构造非 schema 数据，
    // 验证规则仍尊重这个配置位（防御旧数据/未来放宽 schema）。
    render: { ...RENDER, burnSubtitles: (options.burnSubtitles ?? true) as true },
    tracks: [track],
  };
}

describe('shouldBurnSubtitles', () => {
  it('burns a visible subtitle track with a renderable clip', () => {
    expect(shouldBurnSubtitles(project())).toBe(true);
  });

  it('does not burn without a subtitle track', () => {
    expect(shouldBurnSubtitles({ render: RENDER, tracks: [] })).toBe(false);
  });

  it('does not burn when the track is hidden or the project disables subtitles', () => {
    expect(shouldBurnSubtitles(project({ visible: false }))).toBe(false);
    expect(shouldBurnSubtitles(project({ burnSubtitles: false }))).toBe(false);
  });

  it('does not burn when every clip is blank or zero-length', () => {
    expect(shouldBurnSubtitles(project({ clips: [clip({ text: '   ' })] }))).toBe(false);
    expect(shouldBurnSubtitles(project({ clips: [clip({ endMs: 0 })] }))).toBe(false);
    // 有任意一条可渲染字幕就烧录（与 ASS 生成一致）。
    expect(shouldBurnSubtitles(project({ clips: [clip({ text: ' ' }), clip()] }))).toBe(true);
  });
});

describe('isRenderableSubtitleClip', () => {
  it('requires non-empty text and a positive duration', () => {
    expect(isRenderableSubtitleClip(clip())).toBe(true);
    expect(isRenderableSubtitleClip(clip({ text: ' ' }))).toBe(false);
    expect(isRenderableSubtitleClip(clip({ endMs: 0 }))).toBe(false);
  });
});
