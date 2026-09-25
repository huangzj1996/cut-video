import type { Voice } from '../types/voiceover';

export const VOICES: readonly Voice[] = [
  { id: 'gentle', name: '温婉学姐', description: '自然女声 · 推荐' },
  { id: 'steady', name: '沉稳男声', description: '低频清晰' },
  { id: 'news', name: '新闻播报', description: '稳重正式' },
  { id: 'lively', name: '活力讲解', description: '节奏明快' },
];

export const DEFAULT_VOICE_ID = VOICES[0].id;
export const DEFAULT_VOLUME = 82;
export const DEFAULT_SPEED = 1.05;
