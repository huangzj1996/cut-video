import type { SubtitlePreset, SubtitleSettings } from '../types/subtitle';

export const SUBTITLE_SIZE_MIN = 16;
export const SUBTITLE_SIZE_MAX = 74;

export const SUBTITLE_PRESETS = [
  { id: 'white-outline', name: '白字黑边', textColor: '#f5f7fa', outlineColor: '#000000' },
  { id: 'classic-white', name: '经典白字', textColor: '#f5f7fa', outlineColor: '#35373c' },
  { id: 'yellow-outline', name: '黄字黑边', textColor: '#ffd400', outlineColor: '#050505' },
  { id: 'red-outline', name: '红字白边', textColor: '#f05f73', outlineColor: '#ffffff' },
  { id: 'cyan-gray', name: '青灰字幕', textColor: '#9adfe5', outlineColor: '#14181d' },
  { id: 'pink', name: '粉色字幕', textColor: '#ff6ea5', outlineColor: '#ffffff' },
  { id: 'blue', name: '蓝色字幕', textColor: '#24cff2', outlineColor: '#0a0e12' },
] as const satisfies readonly SubtitlePreset[];

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  visible: true,
  fontSize: 42,
  presetId: 'white-outline',
};
