import { z } from 'zod';
import { IdSchema, IsoDateSchema, TimeMsSchema } from '../schema';

export const ASSET_MATCHES_SCHEMA_VERSION = '1.0.0' as const;

export const ASSET_MATCH_ISSUE_CODES = [
  'NO_VIDEO_MATERIAL',
  'COVERAGE_SHORTFALL',
  'SOURCE_RANGE_INVALID',
  'REUSED_ASSET',
] as const;

export const AssetMatchIssueCodeSchema = z.enum(ASSET_MATCH_ISSUE_CODES);
export type AssetMatchIssueCode = z.infer<typeof AssetMatchIssueCodeSchema>;

export const AssetMatchIssueSchema = z.strictObject({
  code: AssetMatchIssueCodeSchema,
  severity: z.enum(['error', 'warning']),
  message: z.string().trim().min(1).max(300),
  sceneId: IdSchema.optional(),
});

export type AssetMatchIssue = z.infer<typeof AssetMatchIssueSchema>;

export const AssetMatchCandidateSchema = z.strictObject({
  assetId: IdSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
});

export type AssetMatchCandidate = z.infer<typeof AssetMatchCandidateSchema>;

export const SelectedAssetSegmentSchema = z
  .strictObject({
    assetId: IdSchema,
    sourceStartMs: TimeMsSchema,
    sourceEndMs: TimeMsSchema,
  })
  .refine((segment) => segment.sourceEndMs > segment.sourceStartMs, {
    message: 'sourceEndMs must be greater than sourceStartMs',
    path: ['sourceEndMs'],
  });

export type SelectedAssetSegment = z.infer<typeof SelectedAssetSegmentSchema>;

export const SceneAssetMatchSchema = z.strictObject({
  sceneId: IdSchema,
  requiredDurationMs: z.number().int().positive(),
  candidates: z.array(AssetMatchCandidateSchema).max(5),
  selected: SelectedAssetSegmentSchema.optional(),
  status: z.enum(['matched', 'partial', 'unmatched']),
  issues: z.array(AssetMatchIssueSchema).max(10),
});

export type SceneAssetMatch = z.infer<typeof SceneAssetMatchSchema>;

export const AssetMatchCollectionSchema = z.strictObject({
  schemaVersion: z.literal(ASSET_MATCHES_SCHEMA_VERSION),
  matchVersion: z.number().int().positive(),
  projectId: IdSchema,
  generatedAt: IsoDateSchema,
  inputFingerprint: z.string().trim().min(1).max(128),
  matches: z.array(SceneAssetMatchSchema).max(30),
  unmatchedSceneIds: z.array(IdSchema),
  issues: z.array(AssetMatchIssueSchema).max(50),
});

export type AssetMatchCollection = z.infer<typeof AssetMatchCollectionSchema>;
