import { z } from 'zod';
import { IdSchema, IsoDateSchema, TimeMsSchema } from '../schema';

export const ASSET_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;
export const ASSET_MANIFEST_VERSION = 1 as const;

export const ASSET_KINDS = ['video', 'image', 'audio'] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const SCAN_ITEM_STATUSES = ['ready', 'changed', 'rejected', 'unreadable'] as const;
export const ScanItemStatusSchema = z.enum(SCAN_ITEM_STATUSES);
export type ScanItemStatus = z.infer<typeof ScanItemStatusSchema>;

/** ffprobe 结果中工作流需要的字段；完整元数据仍保留在 inputs/assets.json。 */
export const AssetProbeSummarySchema = z.strictObject({
  durationMs: TimeMsSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().optional(),
  container: z.string().trim().min(1).max(80).optional(),
  codec: z.string().trim().min(1).max(80).optional(),
  bitRate: z.number().int().nonnegative().optional(),
  hasAudio: z.boolean(),
  isHdr: z.boolean().optional(),
  isVfr: z.boolean(),
  rotation: z.number().int().min(0).max(359).optional(),
});

export type AssetProbeSummary = z.infer<typeof AssetProbeSummarySchema>;

export const KeyframeRefSchema = z.strictObject({
  thumbnailId: IdSchema,
  path: z.string().trim().min(1).max(2_000),
  timeMs: TimeMsSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type KeyframeRef = z.infer<typeof KeyframeRefSchema>;

export const AssetManifestIssueSchema = z.strictObject({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  path: z.string().trim().min(1).max(2_000).optional(),
  severity: z.enum(['error', 'warning', 'info']).optional(),
});

export type AssetManifestIssue = z.infer<typeof AssetManifestIssueSchema>;

export const AssetManifestItemSchema = z.strictObject({
  assetId: IdSchema.nullable(),
  kind: AssetKindSchema,
  path: z.string().trim().min(1).max(2_000),
  fileName: z.string().trim().min(1).max(260),
  sizeBytes: z.number().int().nonnegative(),
  mtimeMs: z.number().int().nonnegative(),
  status: ScanItemStatusSchema,
  probe: AssetProbeSummarySchema.optional(),
  keyframes: z.array(KeyframeRefSchema).max(16),
  issues: z.array(AssetManifestIssueSchema).max(20),
});

export type AssetManifestItem = z.infer<typeof AssetManifestItemSchema>;

export const AssetManifestStatsSchema = z.strictObject({
  filesSeen: z.number().int().nonnegative(),
  directoriesVisited: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
});

export const AssetManifestSchema = z.strictObject({
  schemaVersion: z.literal(ASSET_MANIFEST_SCHEMA_VERSION),
  manifestVersion: z.literal(ASSET_MANIFEST_VERSION),
  projectId: IdSchema,
  scannedAt: IsoDateSchema,
  roots: z.array(z.string().trim().min(1).max(2_000)).max(20),
  items: z.array(AssetManifestItemSchema),
  stats: AssetManifestStatsSchema,
  issues: z.array(AssetManifestIssueSchema).max(100),
});

export type AssetManifest = z.infer<typeof AssetManifestSchema>;
