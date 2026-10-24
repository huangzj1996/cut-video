import { z } from 'zod';
import { IdSchema, IsoDateSchema, TimeMsSchema } from '../schema';
import { KeyframeRefSchema } from './asset-manifest';

export const ANALYZED_ASSETS_SCHEMA_VERSION = '1.0.0' as const;

/**
 * v1 素材分析只使用 ffprobe、关键帧与文件名做技术分析，不调用视觉模型。
 * `analysisSource` 明确标注，避免 UI 把技术描述误认为视觉理解结果。
 */
export const ANALYSIS_SOURCES = ['technical'] as const;

export const TechOrientationSchema = z.enum(['landscape', 'portrait', 'square']);

export const AnalyzedAssetTechnicalSchema = z.strictObject({
  orientation: TechOrientationSchema,
  resolutionLabel: z.string().trim().min(1).max(40),
  durationLabel: z.string().trim().min(1).max(40),
  hasAudio: z.boolean(),
  isVfr: z.boolean(),
});

export type AnalyzedAssetTechnical = z.infer<typeof AnalyzedAssetTechnicalSchema>;

export const AnalyzedAssetSchema = z.strictObject({
  assetId: IdSchema,
  path: z.string().trim().min(1).max(2_000),
  mediaType: z.enum(['video', 'image']),
  durationMs: TimeMsSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().optional(),
  keyframes: z.array(KeyframeRefSchema).max(16),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  description: z.string().trim().min(1).max(600),
  technical: AnalyzedAssetTechnicalSchema,
  status: z.literal('analyzed'),
});

export type AnalyzedAsset = z.infer<typeof AnalyzedAssetSchema>;

export const AnalyzedAssetFailureSchema = z.strictObject({
  assetId: IdSchema.optional(),
  path: z.string().trim().min(1).max(2_000),
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
});

export type AnalyzedAssetFailure = z.infer<typeof AnalyzedAssetFailureSchema>;

export const AnalyzedAssetCollectionSchema = z.strictObject({
  schemaVersion: z.literal(ANALYZED_ASSETS_SCHEMA_VERSION),
  analysisVersion: z.number().int().positive(),
  projectId: IdSchema,
  generatedAt: IsoDateSchema,
  inputFingerprint: z.string().trim().min(1).max(128),
  analysisSource: z.enum(ANALYSIS_SOURCES),
  assets: z.array(AnalyzedAssetSchema),
  failures: z.array(AnalyzedAssetFailureSchema).max(500),
});

export type AnalyzedAssetCollection = z.infer<typeof AnalyzedAssetCollectionSchema>;
