import songData from '../assets/song/song.json';
import type { MusicCategory, MusicSettings, MusicTrack } from '../types/music';

const audioFiles = import.meta.glob('../assets/song/*.m4a', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const coverFiles = import.meta.glob('../assets/music/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const MUSIC_PRIMARY_CATEGORIES: readonly MusicCategory[] = ['全部', '平静', '欢快', '励志', '抒情'];
export const MUSIC_EXTRA_CATEGORIES: readonly MusicCategory[] = ['治愈', '悲壮', '宏伟', '悬疑'];
export const MUSIC_CATEGORY_WIDTHS: Record<MusicCategory, number> = {
  全部: 36, 平静: 44, 欢快: 40, 励志: 40, 抒情: 40,
  治愈: 40, 悲壮: 40, 宏伟: 40, 悬疑: 40,
};
const COVER_BY_MOOD: Record<string, string> = {
  平静: 'eutopia.png', 欢快: 'canon.png', 抒情: 'ylang-ylang.png', 治愈: 'warm-healing.png',
  悲壮: 'my-treasure.png', 宏伟: 'plain-day.png', 悬疑: 'my-treasure.png', 励志: 'canon.png',
};

export function getVisibleMusicCategories(availableWidth: number): readonly MusicCategory[] {
  const visible: MusicCategory[] = [];
  let usedWidth = 28;
  for (const category of MUSIC_PRIMARY_CATEGORIES) {
    const nextWidth = usedWidth + 4 + MUSIC_CATEGORY_WIDTHS[category];
    if (nextWidth > availableWidth) break;
    visible.push(category);
    usedWidth = nextWidth;
  }
  return visible;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = songData.items.flatMap((item) => {
  const audioUrl = audioFiles[`../assets/song/${item.fileName}`];
  if (!audioUrl) return [];

  return [{
    id: item.fileName,
    title: item.title,
    mood: item.mood,
    tempo: item.tempo,
    duration: item.duration,
    scenes: item.scenes,
    audioUrl,
    coverUrl: coverFiles[`../assets/music/${COVER_BY_MOOD[item.mood]}`] ?? null,
  }];
});

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = {
  enabled: true,
  volume: 60,
  appliedTrackId: 'Eutopia.m4a',
};

export function matchesMusicCategory(track: MusicTrack, category: MusicCategory): boolean {
  return category === '全部' || track.mood === category;
}
