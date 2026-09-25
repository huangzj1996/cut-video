import { Pause, Play } from 'lucide-react';
import type { MusicTrack } from '../../../types/music';

interface MusicTrackOptionProps {
  track: MusicTrack;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onTogglePreview: () => void;
}

export function MusicTrackOption({ track, selected, playing, onSelect, onTogglePreview }: MusicTrackOptionProps) {
  return (
    <div className={`flex h-[54px] w-full items-center gap-[9px] rounded-[9px] border px-[8px] transition-colors duration-150 hover:bg-[#3A3B3E] ${selected ? 'border-[var(--accent-red)] bg-[#34242b]' : 'border-transparent bg-[#111214]'}`}>
      <button
        type="button"
        aria-label={`${playing ? '暂停' : '开始'}试听 ${track.title}`}
        title={playing ? '暂停试听' : '开始试听'}
        onClick={onTogglePreview}
        className="relative flex h-[36px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-gradient-to-br from-[#675c79] to-[#262833] text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        {track.coverUrl && <img src={track.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-black/40">
          {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
        </span>
      </button>
      <button
        type="button"
        aria-label={`选择音乐 ${track.title}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-bold">{track.title}</span>
          <span className="mt-[2px] block truncate text-[10px] text-[var(--text-muted)]">{track.mood} · {track.tempo} · {track.scenes.join(' / ')}</span>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{track.duration}</span>
      </button>
    </div>
  );
}
