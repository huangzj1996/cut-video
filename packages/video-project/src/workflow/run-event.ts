import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';
import { ApprovalGateSchema, ApprovalInterruptPayloadSchema } from './approval';
import { ArtifactReferenceSchema } from './artifact';
import { WorkflowRunStatusSchema } from './state';
import { WorkflowNodeIdSchema, WorkflowPhaseIdSchema } from './workflow-definition';

export const RUN_EVENT_SCHEMA_VERSION = '1.0.0' as const;

export const RUN_EVENT_TYPES = [
  'run.started',
  'run.resumed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.interrupted',
  'node.started',
  'node.progress',
  'node.waiting_user',
  'node.completed',
  'node.failed',
  'artifact.written',
] as const;

export const RunEventTypeSchema = z.enum(RUN_EVENT_TYPES);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventErrorSchema = z.strictObject({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
});

export type RunEventError = z.infer<typeof RunEventErrorSchema>;

export const RunEventProgressSchema = z
  .strictObject({
    current: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .refine((progress) => progress.current <= progress.total, {
    message: 'progress.current must not exceed progress.total',
    path: ['current'],
  });

export const RunEventSchema = z.strictObject({
  schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
  runId: IdSchema,
  projectId: IdSchema,
  seq: z.number().int().positive(),
  type: RunEventTypeSchema,
  phase: WorkflowPhaseIdSchema.optional(),
  nodeId: WorkflowNodeIdSchema.optional(),
  status: WorkflowRunStatusSchema.optional(),
  attempt: z.number().int().positive().optional(),
  message: z.string().trim().max(1_000).optional(),
  progress: RunEventProgressSchema.optional(),
  artifact: ArtifactReferenceSchema.optional(),
  gate: ApprovalGateSchema.optional(),
  approval: ApprovalInterruptPayloadSchema.optional(),
  error: RunEventErrorSchema.optional(),
  timestamp: IsoDateSchema,
});

export type RunEvent = z.infer<typeof RunEventSchema>;
