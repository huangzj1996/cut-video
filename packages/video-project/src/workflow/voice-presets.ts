import { z } from 'zod';

/**
 * 首版内置音色。首版 TTS 是静音模拟，`speed` 只影响时长估算。
 * 音色 ID 会写进 CreationInput / ProductionSpec / VoiceSegment，
 * 因此保持稳定，不随 UI 文案变化。
 */
export const VOICE_PRESET_IDS = [
  'wenrou-xuejie',
  'xinwen-bobao',
  'chenwen-nansheng',
  'huoli-jiangjie',
] as const;

export const VoicePresetIdSchema = z.enum(VOICE_PRESET_IDS);

export type VoicePresetId = z.infer<typeof VoicePresetIdSchema>;

export const VoicePresetSchema = z.strictObject({
  id: VoicePresetIdSchema,
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(160),
  speed: z.number().min(0.5).max(2),
});

export type VoicePreset = z.infer<typeof VoicePresetSchema>;

export const VOICE_PRESETS: readonly VoicePreset[] = [
  { id: 'wenrou-xuejie', name: '温婉学姐', description: '柔和亲切 · 适合知识口播', speed: 1 },
  { id: 'xinwen-bobao', name: '新闻播报', description: '清晰正式 · 适合资讯解说', speed: 1.05 },
  { id: 'chenwen-nansheng', name: '沉稳男声', description: '低沉可靠 · 适合商业叙事', speed: 0.95 },
  { id: 'huoli-jiangjie', name: '活力讲解', description: '明快有力 · 适合教程种草', speed: 1.1 },
];

export function getVoicePreset(id: VoicePresetId): VoicePreset {
  const preset = VOICE_PRESETS.find((item) => item.id === id);

  if (!preset) {
    throw new Error(`unknown voice preset: ${id}`);
  }

  return preset;
}
