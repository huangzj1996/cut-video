import { useEffect, useRef, useState } from 'react';
import { MUSIC_TRACKS } from '../../../constants/music';
import type { MusicCategory, MusicPanelProps } from '../../../types/music';
import { ConfigPanelHeader } from '../ConfigPanelHeader';
import { CurrentMusicCard } from './CurrentMusicCard';
import { MusicVolumeCard } from './MusicVolumeCard';
import { RecommendedMusicCard } from './RecommendedMusicCard';

export function MusicPanel({ settings, onChange }: MusicPanelProps) {
  const [category, setCategory] = useState<MusicCategory>('全部');
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentTrack = MUSIC_TRACKS.find((track) => track.id === settings.appliedTrackId) ?? null;

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = settings.volume / 100;
  }, [settings.volume]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  function stopPreview() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingTrackId(null);
  }

  function selectTrack(id: string) {
    onChange({ ...settings, appliedTrackId: id });
    if (playingTrackId && playingTrackId !== id) stopPreview();
  }

  function togglePreview(id: string) {
    if (playingTrackId === id) {
      stopPreview();
      return;
    }
    stopPreview();
    const track = MUSIC_TRACKS.find((item) => item.id === id);
    if (!track) return;
    const audio = new Audio(track.audioUrl);
    audio.volume = settings.volume / 100;
    audio.onended = () => setPlayingTrackId(null);
    audioRef.current = audio;
    setPlayingTrackId(id);
    void audio.play().catch(() => {
      if (audioRef.current === audio) stopPreview();
    });
  }

  function toggleEnabled() {
    if (settings.enabled) stopPreview();
    onChange({ ...settings, enabled: !settings.enabled });
  }

  return (
    <>
      <ConfigPanelHeader>
        <div className="flex h-[54px] items-start justify-between">
          <div>
            <h2 className="text-[20px] leading-[29px] font-extrabold">音乐设置</h2>
            <p className="mt-[5px] text-[10px] font-semibold text-[var(--text-muted)]">控制背景音乐与推荐曲库</p>
          </div>
          <div className="mt-[13px] flex items-center gap-2 text-[11px] font-semibold">
            <span>开启</span>
            <button type="button" role="switch" aria-label="开启背景音乐" aria-checked={settings.enabled} onClick={toggleEnabled} className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${settings.enabled ? 'bg-[var(--accent-red)]' : 'bg-[#41454e]'}`}>
              <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-[left] duration-200 ${settings.enabled ? 'left-[23px]' : 'left-[3px]'}`} />
            </button>
          </div>
        </div>
      </ConfigPanelHeader>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <CurrentMusicCard track={currentTrack} />
        <MusicVolumeCard value={settings.volume} onChange={(volume) => onChange({ ...settings, volume })} />
        <RecommendedMusicCard category={category} onCategoryChange={setCategory} selectedTrackId={settings.appliedTrackId} playingTrackId={playingTrackId} onTrackSelect={selectTrack} onTrackPreview={togglePreview} />
      </div>
    </>
  );
}
