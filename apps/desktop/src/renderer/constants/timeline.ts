import type { RulerMark, VideoClip } from '../types/timeline';

export const DURATION_SECONDS = 87;
export const TIMELINE_DISPLAY_TIME = `00:00:00 / ${String(Math.floor(DURATION_SECONDS / 3600)).padStart(2, '0')}:${String(Math.floor((DURATION_SECONDS % 3600) / 60)).padStart(2, '0')}:${String(DURATION_SECONDS % 60).padStart(2, '0')}`;
export const INITIAL_ZOOM = 1.4;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;

export const RULER_MARKS: readonly RulerMark[] = Array.from({ length: Math.floor(DURATION_SECONDS / 10) + 1 }, (_, index) => {
  const seconds = index * 10;
  return { seconds, label: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` };
});

export const VIDEO_CLIPS: readonly VideoClip[] = [
  { label: '分镜01', start: 0.8, end: 15.2, color: 'bg-[#1f6158] border-[#25d0b1]', accent: 'bg-[#25d0b1]' },
  { label: '分镜02', start: 16.1, end: 29.2, color: 'bg-[#294673] border-[#ffffff20]', accent: 'bg-[#5b8cff]' },
  { label: '分镜03', start: 30.1, end: 43, color: 'bg-[#503984] border-[#ffffff20]', accent: 'bg-[#8b6af7]' },
  { label: '分镜04', start: 44, end: 57.7, color: 'bg-[#74313e] border-[#ffffff20]', accent: 'bg-[#f05f73]' },
  { label: '分镜05', start: 58.7, end: 72.7, color: 'bg-[#3d3f45] border-[#ffffff20]', accent: 'bg-[#a9afba]' },
];

export const WAVEFORM_BARS = ['h-2', 'h-3', 'h-4', 'h-5', 'h-3', 'h-2', 'h-4', 'h-5', 'h-4', 'h-3', 'h-2', 'h-4', 'h-5', 'h-3', 'h-2'] as const;
