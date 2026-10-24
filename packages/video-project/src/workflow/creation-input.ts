import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';
import { VoicePresetIdSchema } from './voice-presets';

export const CREATION_INPUT_SCHEMA_VERSION = '1.0.0' as const;

export const MAX_SCRIPT_LENGTH = 10_000;
export const MAX_REQUIREMENTS_LENGTH = 2_000;
export const MAX_ASSET_PATH_LENGTH = 2_000;

/**
 * 创作页提交的原始输入。`assetPath` 是主进程内部使用的本地路径，
 * 只写入 `<project>/inputs/creation.json`，不进入 ChatMessage。
 */
export const CreationInputDraftSchema = z.strictObject({
  script: z.string().trim().min(1).max(MAX_SCRIPT_LENGTH),
  requirementsText: z.string().trim().min(1).max(MAX_REQUIREMENTS_LENGTH).optional(),
  voicePresetId: VoicePresetIdSchema,
  assetPath: z.string().trim().min(1).max(MAX_ASSET_PATH_LENGTH).optional(),
});

export type CreationInputDraft = z.infer<typeof CreationInputDraftSchema>;

export const CreationInputSchema = CreationInputDraftSchema.extend({
  schemaVersion: z.literal(CREATION_INPUT_SCHEMA_VERSION),
  projectId: IdSchema,
  createdAt: IsoDateSchema,
});

export type CreationInput = z.infer<typeof CreationInputSchema>;
