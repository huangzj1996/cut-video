import { z } from 'zod';
import { SubtitleStyleSchema } from '../schema';
import { VoicePresetIdSchema } from './voice-presets';

export const PRODUCTION_SPEC_SCHEMA_VERSION = '1.0.0' as const;

export const ProductionPaletteSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(200),
});

export const ProductionFontSchema = z.strictObject({
  family: z.string().trim().min(1).max(80),
  usage: z.string().trim().min(1).max(80),
});

export const ProductionVoiceProfileSchema = z.strictObject({
  presetId: VoicePresetIdSchema,
  displayName: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(160),
  speed: z.number().min(0.5).max(2),
});

export const DeliverySpecSchema = z.strictObject({
  container: z.literal('mp4'),
  videoCodec: z.literal('h264'),
  audioCodec: z.literal('aac'),
  audioBitrateKbps: z.literal(192),
  burnSubtitles: z.literal(true),
});

export const DurationRangeSchema = z
  .strictObject({
    minSeconds: z.number().int().min(15).max(300),
    maxSeconds: z.number().int().min(15).max(300),
    targetSeconds: z.number().int().min(15).max(300),
  })
  .refine(
    (range) => range.minSeconds <= range.targetSeconds && range.targetSeconds <= range.maxSeconds,
    { message: 'durationRange must satisfy min <= target <= max', path: ['targetSeconds'] },
  );

export const ProductionSpecSchema = z.strictObject({
  schemaVersion: z.literal(PRODUCTION_SPEC_SCHEMA_VERSION),
  specVersion: z.number().int().positive(),
  contentFingerprint: z.string().trim().min(1).max(128),
  videoType: z.string().trim().min(1).max(80),
  recommendedScheme: z.literal('material_edit'),
  visualStyle: z.string().trim().min(1).max(300),
  palette: ProductionPaletteSchema,
  font: ProductionFontSchema,
  voiceProfile: ProductionVoiceProfileSchema,
  subtitleStyle: SubtitleStyleSchema,
  materialStrategy: z.string().trim().min(1).max(300),
  rhythm: z.string().trim().min(1).max(300),
  deliverySpec: DeliverySpecSchema,
  aspectRatio: z.literal('16:9'),
  resolution: z.literal('1920x1080'),
  fps: z.literal(30),
  durationRange: DurationRangeSchema,
  sourceAudioMuted: z.literal(true),
  normalizationNotes: z.array(z.string().trim().min(1).max(300)).max(10),
});

export type ProductionSpec = z.infer<typeof ProductionSpecSchema>;
