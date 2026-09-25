import { MUSIC_TRACKS, matchesMusicCategory } from '../../../constants/music';
import type { MusicCategory } from '../../../types/music';
import { ConfigCard } from '../ConfigCard';
import { MusicCategoryPicker } from './MusicCategoryPicker';
import { MusicTrackOption } from './MusicTrackOption';

interface RecommendedMusicCardProps {
  category: MusicCategory;
  onCategoryChange: (category: MusicCategory) => void;
  selectedTrackId: string | null;
  playingTrackId: string | null;
  onTrackSelect: (id: string) => void;
  onTrackPreview: (id: string) => void;
}

export function RecommendedMusicCard({ category, onCategoryChange, selectedTrackId, playingTrackId, onTrackSelect, onTrackPreview }: RecommendedMusicCardProps) {
  const tracks = MUSIC_TRACKS.filter((track) => matchesMusicCategory(track, category));

  return (
    <ConfigCard className="mt-[14px] flex min-h-[276px] flex-col p-[13px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-extrabold">推荐音乐</h3>
        <span className="rounded-md bg-[#30343c] px-[7px] py-[3px] text-[10px] text-[var(--text-secondary)]">{category}</span>
      </div>
      <MusicCategoryPicker value={category} onChange={onCategoryChange} />
      <div className="thin-scrollbar mt-[10px] min-h-0 flex-1 space-y-[5px] overflow-y-auto" style={{ maxHeight: 177 }}>
        {tracks.length === 0 && <p className="px-1 py-4 text-[11px] text-[var(--text-muted)]">暂无可用的本地曲目</p>}
        {tracks.map((track) => (
          <MusicTrackOption key={track.id} track={track} selected={selectedTrackId === track.id} playing={playingTrackId === track.id} onSelect={() => onTrackSelect(track.id)} onTogglePreview={() => onTrackPreview(track.id)} />
        ))}
      </div>
    </ConfigCard>
  );
}
