import { Music2 } from 'lucide-react';
import type { MusicTrack } from '../../../types/music';
import { ConfigCard } from '../ConfigCard';

export function CurrentMusicCard({ track }: { track: MusicTrack | null }) {
  return (
    <ConfigCard className="mt-4 h-[118px] p-[13px]">
      <h3 className="text-[14px] font-extrabold">当前音乐</h3>
      <div className="mt-[10px] flex items-center gap-[11px]">
        <span className="flex h-[56px] w-[56px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-gradient-to-br from-[#856c93] via-[#525979] to-[#232c40]">
          {track?.coverUrl ? <img src={track.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={22} strokeWidth={1.6} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-extrabold">{track?.title ?? '未添加音乐'}</span>
          <span className="mt-1 block truncate text-[10px] text-[var(--text-muted)]">{track ? `${track.mood} / ${track.scenes.join('、')}` : '从推荐曲库中选择一首曲目'}</span>
          {track && <span className="mt-1 block text-[10px] text-[var(--text-muted)]">{track.tempo} · {track.duration} · 当前已选</span>}
        </span>
      </div>
    </ConfigCard>
  );
}
