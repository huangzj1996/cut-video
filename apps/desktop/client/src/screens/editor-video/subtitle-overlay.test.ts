import { describe, expect, it } from 'vitest';
import { SUBTITLE_PRESET_IDS } from '@miaoma/video-project';
import type { SubtitleClip, SubtitleStyle, VideoProject } from '@miaoma/video-project';
import { SUBTITLE_PRESET_STYLES, subtitlePresetStyle } from '../subtitle-presets';
import {
  clampSubtitleFontSize,
  resolveSubtitleOverlay,
  subtitleFontSizeCss,
  SUBTITLE_FONT_SIZE_MAX,
  SUBTITLE_FONT_SIZE_MIN,
} from './subtitle-overlay';

const AI_RUN = {
  completedAt: '2026-10-27T10:00:00.000Z',
  inputFingerprint: 'fingerprint',
  model: 'deepseek-chat',
  modelConfigVersion: 'v1',
  provider: 'deepseek',
  runId: 'run-1',
  startedAt: '2026-10-27T10:00:00.000Z',
} as const;

function makeClip(id: string, startMs: number, endMs: number, text: string): SubtitleClip {
  return {
    assetId: 'subtitle-asset-1',
    endMs,
    id,
    kind: 'subtitle',
    sceneId: 'scene-1',
    startMs,
    text,
  };
}

function makeProject(
  options: {
    clips?: SubtitleClip[];
    style?: SubtitleStyle;
    visible?: boolean;
  } = {},
): VideoProject {
  const {
    clips = [makeClip('cue-1', 1_000, 4_000, '第一句字幕')],
    style,
    visible = true,
  } = options;

  return {
    ai: AI_RUN,
    assets: { music: [], subtitles: [], thumbnails: [], videos: [], voices: [] },
    canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
    project: {
      contentRevision: 1,
      createdAt: '2026-10-27T10:00:00.000Z',
      name: '字幕预览工程',
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
        durationMs: 8_000,
        goal: '演示字幕叠层',
        id: 'scene-1',
        index: 1,
        matchedVideoAssetIds: [],
        notes: '',
        script: '第一句字幕。',
        subtitleIds: ['subtitle-asset-1'],
        title: '开场',
        visualIntent: '白底',
        voiceAssetId: 'voice-1',
      },
    ],
    schemaVersion: '1.0.0',
    tracks: [
      {
        clips,
        id: 'track-subtitle',
        kind: 'subtitle',
        style: style ?? { fontSize: 42, presetId: 'white-outline' },
        visible,
      },
    ],
  };
}

describe('resolveSubtitleOverlay', () => {
  it('returns null when the project has no subtitle track', () => {
    const project = { ...makeProject(), tracks: [] };

    expect(resolveSubtitleOverlay(project, 1.5)).toBeNull();
  });

  it('returns the cue that covers the playhead', () => {
    expect(resolveSubtitleOverlay(makeProject(), 2.5)?.text).toBe('第一句字幕');
  });

  it('shows the cue from its start and hides it at its end', () => {
    const project = makeProject();

    expect(resolveSubtitleOverlay(project, 1)?.text).toBe('第一句字幕');
    expect(resolveSubtitleOverlay(project, 3.999)?.text).toBe('第一句字幕');
    expect(resolveSubtitleOverlay(project, 4)).toBeNull();
  });

  it('returns null before the first cue and after the last cue', () => {
    const project = makeProject();

    expect(resolveSubtitleOverlay(project, 0)).toBeNull();
    expect(resolveSubtitleOverlay(project, 30)).toBeNull();
  });

  it('switches cues at the shared boundary without a gap', () => {
    const project = makeProject({
      clips: [makeClip('cue-1', 0, 2_000, '第一句'), makeClip('cue-2', 2_000, 4_000, '第二句')],
    });

    expect(resolveSubtitleOverlay(project, 1.9)?.text).toBe('第一句');
    expect(resolveSubtitleOverlay(project, 2)?.text).toBe('第二句');
  });

  // 回归：1.009 * 1000 === 1008.999…，直接在浮点秒上乘 1000 比较会把共享边界判给前一条。
  // 1009ms / 2009ms 来自真实工程（b0fca062、bfa260ea）的 cue 起点。
  it('hits the next cue when adjacent cues share a 1009ms boundary at 1.009s', () => {
    const project = makeProject({
      clips: [
        makeClip('cue-1', 0, 1_009, '城市美景。'),
        makeClip('cue-2', 1_009, 3_009, '把目光放向城市，看看眼前的风景。'),
      ],
    });

    expect(resolveSubtitleOverlay(project, 1.009)?.text).toBe('把目光放向城市，看看眼前的风景。');
  });

  it('does not keep the previous cue on its 1009ms end boundary at 1.009s', () => {
    const project = makeProject({ clips: [makeClip('cue-1', 0, 1_009, '城市美景。')] });

    expect(resolveSubtitleOverlay(project, 1.009)).toBeNull();
  });

  it('crosses a 2009ms shared boundary at 2.009s', () => {
    const project = makeProject({
      clips: [
        makeClip('cue-1', 1_009, 2_009, '城市美景。'),
        makeClip('cue-2', 2_009, 3_009, '把目光放向城市，看看眼前的风景。'),
      ],
    });

    expect(resolveSubtitleOverlay(project, 2.009)?.text).toBe('把目光放向城市，看看眼前的风景。');
  });

  it('does not keep the previous cue on its 2009ms end boundary at 2.009s', () => {
    const project = makeProject({ clips: [makeClip('cue-1', 1_009, 2_009, '城市美景。')] });

    expect(resolveSubtitleOverlay(project, 2.009)).toBeNull();
  });

  it('does not render while the subtitle track is hidden', () => {
    const project = makeProject({ visible: false });

    expect(resolveSubtitleOverlay(project, 2.5)).toBeNull();
  });

  it('does not render an empty cue box for whitespace-only text', () => {
    const project = makeProject({ clips: [makeClip('cue-1', 1_000, 4_000, '   ')] });

    expect(resolveSubtitleOverlay(project, 2.5)).toBeNull();
  });

  it('carries the project font size and preset colour/outline of the active cue', () => {
    const project = makeProject({ style: { fontSize: 42, presetId: 'yellow' } });

    expect(resolveSubtitleOverlay(project, 2.5)).toMatchObject({
      clipId: 'cue-1',
      color: '#ffd400',
      fontSize: 42,
      outline: '#050505',
      presetId: 'yellow',
      text: '第一句字幕',
    });
  });

  it('clamps an out-of-range project font size to the schema bounds', () => {
    const project = makeProject({ style: { fontSize: 120, presetId: 'blue' } });

    expect(resolveSubtitleOverlay(project, 2.5)?.fontSize).toBe(SUBTITLE_FONT_SIZE_MAX);
  });
});

describe('subtitleFontSizeCss', () => {
  it('scales the 24px minimum against the 1920x1080 canvas', () => {
    expect(subtitleFontSizeCss(SUBTITLE_FONT_SIZE_MIN)).toBe('min(1.25cqw, 2.2222cqh)');
  });

  it('scales the 72px maximum against the 1920x1080 canvas', () => {
    expect(subtitleFontSizeCss(SUBTITLE_FONT_SIZE_MAX)).toBe('min(3.75cqw, 6.6667cqh)');
  });

  it('keeps the stage-proportional scale linear between the bounds', () => {
    expect(subtitleFontSizeCss(48)).toBe('min(2.5cqw, 4.4444cqh)');
  });

  it('clamps values outside the 24-72 range instead of overflowing the stage', () => {
    expect(subtitleFontSizeCss(10)).toBe(subtitleFontSizeCss(SUBTITLE_FONT_SIZE_MIN));
    expect(subtitleFontSizeCss(200)).toBe(subtitleFontSizeCss(SUBTITLE_FONT_SIZE_MAX));
  });
});

describe('clampSubtitleFontSize', () => {
  it('keeps the 24 and 72 boundaries untouched', () => {
    expect(clampSubtitleFontSize(SUBTITLE_FONT_SIZE_MIN)).toBe(24);
    expect(clampSubtitleFontSize(SUBTITLE_FONT_SIZE_MAX)).toBe(72);
  });

  it('clamps below and above the schema bounds', () => {
    expect(clampSubtitleFontSize(23)).toBe(24);
    expect(clampSubtitleFontSize(73)).toBe(72);
  });

  it('falls back to the minimum for non-finite input', () => {
    expect(clampSubtitleFontSize(Number.NaN)).toBe(24);
  });
});

describe('subtitle preset mapping', () => {
  it('defines colour and outline for all seven preset ids', () => {
    expect(SUBTITLE_PRESET_IDS).toHaveLength(7);

    for (const presetId of SUBTITLE_PRESET_IDS) {
      const preset = subtitlePresetStyle(presetId);

      expect(preset.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.outline).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('maps white-outline to a white fill with a black outline', () => {
    expect(subtitlePresetStyle('white-outline')).toMatchObject({
      color: '#f5f7fa',
      outline: '#000000',
    });
  });

  it('gives every preset a distinct colour/outline pair', () => {
    const pairs = new Set(
      SUBTITLE_PRESET_IDS.map((presetId) => {
        const preset = SUBTITLE_PRESET_STYLES[presetId];

        return `${preset.color}/${preset.outline}`;
      }),
    );

    expect(pairs.size).toBe(SUBTITLE_PRESET_IDS.length);
  });

  it('resolves every one of the seven preset ids through the overlay', () => {
    for (const presetId of SUBTITLE_PRESET_IDS) {
      const overlay = resolveSubtitleOverlay(
        makeProject({ style: { fontSize: 42, presetId } }),
        2.5,
      );

      expect(overlay).toMatchObject({
        color: SUBTITLE_PRESET_STYLES[presetId].color,
        outline: SUBTITLE_PRESET_STYLES[presetId].outline,
        presetId,
      });
    }
  });
});
