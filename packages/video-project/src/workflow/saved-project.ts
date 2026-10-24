import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';

export const SAVED_PROJECT_REF_SCHEMA_VERSION = '1.0.0' as const;

/**
 * `savedProjectPath` 是主进程内部绝对路径，只写入工程内的 SavedProjectRef
 * 与 run.json，不通过 IPC 返回渲染进程。
 */
export const SavedProjectRefSchema = z.strictObject({
  schemaVersion: z.literal(SAVED_PROJECT_REF_SCHEMA_VERSION),
  projectId: IdSchema,
  runId: IdSchema,
  savedProjectPath: z.string().trim().min(1).max(2_000),
  contentRevision: z.number().int().nonnegative(),
  contentFingerprint: z.string().trim().min(1).max(128),
  savedAt: IsoDateSchema,
});

export type SavedProjectRef = z.infer<typeof SavedProjectRefSchema>;
