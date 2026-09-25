import { Maximize2, Play, Volume2 } from 'lucide-react';
import { TIMELINE_DISPLAY_TIME } from '../constants/timeline';
import type { PreviewPanelProps } from '../types/preview';
import { SubtitleOverlay } from './preview/SubtitleOverlay';

export function PreviewPanel({ scene, subtitleSettings }: PreviewPanelProps) {
  return (
    <section aria-label="视频预览" className="flex min-w-0 flex-1 flex-col bg-[#101116] px-[10px] pt-[46px]">
      <div className="preview-checkerboard relative min-h-0 flex-1 overflow-hidden rounded-lg border border-[#444a52]">
        <SubtitleOverlay scene={scene} settings={subtitleSettings} />
      </div>
      <div className="flex h-[74px] shrink-0 items-center justify-between px-4">
        <span className="font-mono text-[14px] font-semibold text-[var(--text-secondary)]">{TIMELINE_DISPLAY_TIME}</span>
        <button type="button" aria-label="播放预览" className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-[#1a1d22]">
          <Play size={24} strokeWidth={1.8} />
        </button>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="音量" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1d22] text-[var(--text-secondary)] hover:text-white"><Volume2 size={18} /></button>
          <button type="button" aria-label="放大预览" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1d22] text-[var(--text-secondary)] hover:text-white"><Maximize2 size={18} /></button>
        </div>
      </div>
    </section>
  );
}
