import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';
import { ArtifactReferenceSchema } from './artifact';

export const APPROVAL_SCHEMA_VERSION = '1.0.0' as const;

export const APPROVAL_GATES = ['A1', 'A2', 'A3'] as const;
export const ApprovalGateSchema = z.enum(APPROVAL_GATES);
export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;

export const APPROVAL_DECISIONS = ['approve', 'request_changes'] as const;
export const ApprovalDecisionKindSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecisionKind = z.infer<typeof ApprovalDecisionKindSchema>;

/**
 * `interrupt()` 的 resume 值。确认必须显式；其余文本一律走修改分支，
 * 不允许模型或主进程静默替用户确认。
 */
export const ApprovalDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    rawText: z.string().trim().max(2_000).optional(),
  }),
  z.strictObject({
    decision: z.literal('request_changes'),
    feedback: z.string().trim().min(1).max(2_000),
    rawText: z.string().trim().max(2_000).optional(),
  }),
]);

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** interrupt payload 只放审批所需引用和摘要，完整产物由 UI 读取。 */
export const ApprovalInterruptPayloadSchema = z.strictObject({
  gate: ApprovalGateSchema,
  artifact: ArtifactReferenceSchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  prompt: z.string().trim().min(1).max(200),
});

export type ApprovalInterruptPayload = z.infer<typeof ApprovalInterruptPayloadSchema>;

export const ApprovalResultSchema = z.strictObject({
  schemaVersion: z.literal(APPROVAL_SCHEMA_VERSION),
  approvalId: IdSchema,
  gate: ApprovalGateSchema,
  decision: ApprovalDecisionKindSchema,
  artifact: ArtifactReferenceSchema,
  runId: IdSchema,
  feedback: z.string().trim().max(2_000).optional(),
  rawText: z.string().trim().max(2_000).optional(),
  approvedAt: IsoDateSchema,
});

export type ApprovalResult = z.infer<typeof ApprovalResultSchema>;
