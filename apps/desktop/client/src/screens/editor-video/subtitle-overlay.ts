import type {
  SubtitleClip,
  SubtitlePresetId,
  SubtitleTrack,
  VideoProject,
} from '@miaoma/video-project';
import { subtitlePresetStyle } from '../subtitle-presets';

/**
 * 预览字幕叠层：把播放头位置翻译成“当前该显示哪条字幕、用什么样式”。
 * 这里只做纯计算，不碰 DOM；滚动播放、窗口缩放与全屏都由 CSS 容器查询承担。
 */

/** 工程画布固定 16:9 1920×1080：字号以画布像素定义，预览按舞台比例缩放。 */
export const SUBTITLE_CANVAS_WIDTH = 1920;
export const SUBTITLE_CANVAS_HEIGHT = 1080;

/** 与 `SubtitleStyleSchema` 的 24–72 保持一致；越界数据不让它撑破安全区。 */
export const SUBTITLE_FONT_SIZE_MIN = 24;
export const SUBTITLE_FONT_SIZE_MAX = 72;

/** 容器查询单位保留 4 位小数即可，足够让 24–72 的字号连续缩放。 */
const UNIT_PRECISION = 10_000;

export interface SubtitleOverlay {
  clipId: string;
  color: string;
  fontSize: number;
  fontSizeCss: string;
  outline: string;
  presetId: SubtitlePresetId;
  text: string;
}

export function clampSubtitleFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) {
    return SUBTITLE_FONT_SIZE_MIN;
  }

  return Math.min(SUBTITLE_FONT_SIZE_MAX, Math.max(SUBTITLE_FONT_SIZE_MIN, fontSize));
}

function containerUnit(canvasPixels: number, canvasSize: number): number {
  return Math.round((canvasPixels / canvasSize) * 100 * UNIT_PRECISION) / UNIT_PRECISION;
}

/**
 * 字号换算成容器查询单位。舞台宽高都可能先触边，取宽/高两个比例中更小的那个，
 * 与 `object-fit: contain` 的画面缩放一致；窗口变化或全屏时由浏览器重算，不需要 JS 监听。
 */
export function subtitleFontSizeCss(fontSize: number): string {
  const clamped = clampSubtitleFontSize(fontSize);
  const widthUnits = containerUnit(clamped, SUBTITLE_CANVAS_WIDTH);
  const heightUnits = containerUnit(clamped, SUBTITLE_CANVAS_HEIGHT);

  return `min(${widthUnits}cqw, ${heightUnits}cqh)`;
}

export function findSubtitleTrack(project: VideoProject): SubtitleTrack | undefined {
  return project.tracks.find((track): track is SubtitleTrack => track.kind === 'subtitle');
}

/**
 * 活动字幕区间是左闭右开：起点出现、终点消失，相邻字幕在共享边界上直接切换。
 */
export function findActiveSubtitleClip(
  track: SubtitleTrack,
  timelineSeconds: number,
): SubtitleClip | undefined {
  if (!Number.isFinite(timelineSeconds)) {
    return undefined;
  }

  // 播放头是浮点秒，直接乘 1000 会落到 1008.999… 之类的值；
  // 先归一化到整数毫秒，共享边界（如 1009ms）才会命中后一条字幕。
  const timeMs = Math.round(timelineSeconds * 1_000);

  return track.clips
    .slice()
    .sort((left, right) => left.startMs - right.startMs)
    .find((clip) => timeMs >= clip.startMs && timeMs < clip.endMs);
}

/**
 * 返回当前应叠加的字幕。没有字幕轨、轨道关闭、播放头不在任何字幕区间、
 * 或字幕文本为空时返回 null —— 预览不显示任何没有工程来源的占位文案。
 */
export function resolveSubtitleOverlay(
  project: VideoProject,
  timelineSeconds: number,
  /** 面板拖动字号时的未提交值；传 null 时读工程里的已保存字号。 */
  fontSizeOverride: number | null = null,
): SubtitleOverlay | null {
  const track = findSubtitleTrack(project);

  if (!track || !track.visible) {
    return null;
  }

  const clip = findActiveSubtitleClip(track, timelineSeconds);

  if (!clip || clip.text.trim().length === 0) {
    return null;
  }

  const preset = subtitlePresetStyle(track.style.presetId);
  const fontSize = clampSubtitleFontSize(fontSizeOverride ?? track.style.fontSize);

  return {
    clipId: clip.id,
    color: preset.color,
    fontSize,
    fontSizeCss: subtitleFontSizeCss(fontSize),
    outline: preset.outline,
    presetId: track.style.presetId,
    text: clip.text,
  };
}
