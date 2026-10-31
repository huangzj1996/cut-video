import type { SubtitlePresetId } from '@miaoma/video-project';

/**
 * 字幕样式预设的展示定义：字幕面板的样式卡与预览叠层共用同一份颜色/描边，
 * 避免两处各写一套后悄悄漂移（后续导出映射 ASS 也以这里为准）。
 */
export interface SubtitlePresetStyle {
  color: string;
  label: string;
  outline: string;
}

export const SUBTITLE_PRESET_STYLES: Record<SubtitlePresetId, SubtitlePresetStyle> = {
  'white-outline': {
    color: '#f5f7fa',
    label: '白字黑边',
    outline: '#000000',
  },
  'classic-white': {
    color: '#f5f7fa',
    label: '经典白字',
    outline: '#35373c',
  },
  yellow: {
    color: '#ffd400',
    label: '黄字黑边',
    outline: '#050505',
  },
  red: {
    color: '#f05f73',
    label: '红字白边',
    outline: '#ffffff',
  },
  cyan: {
    color: '#9adfe5',
    label: '青灰字幕',
    outline: '#14181d',
  },
  pink: {
    color: '#ff6ea5',
    label: '粉色字幕',
    outline: '#ffffff',
  },
  blue: {
    color: '#24cff2',
    label: '蓝色字幕',
    outline: '#0a0e12',
  },
};

export function subtitlePresetStyle(presetId: SubtitlePresetId): SubtitlePresetStyle {
  return SUBTITLE_PRESET_STYLES[presetId];
}
