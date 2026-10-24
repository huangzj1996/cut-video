import { z } from 'zod';
import { CreativeBriefContentSchema } from '../creative-brief';
import { IdSchema } from '../schema';
import {
  ApprovalDecisionKindSchema,
  ApprovalGateSchema,
  ApprovalInterruptPayloadSchema,
} from '../workflow/approval';
import { ArtifactReferenceSchema } from '../workflow/artifact';
import { ProductionSpecSchema } from '../workflow/production-spec';
import { WorkflowNodeIdSchema, WorkflowPhaseIdSchema } from '../workflow/workflow-definition';
import { VoicePresetIdSchema } from '../workflow/voice-presets';
import { ChatTagGroupSchema, ExecutionStatusSchema, ExportStatusSchema } from './enums';

function text(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

export const ChatTagSchema = z.strictObject({
  group: ChatTagGroupSchema,
  values: z.array(text(40)).min(1).max(10),
});

export type ChatTag = z.infer<typeof ChatTagSchema>;

export const InitialRequestPayloadSchema = z.strictObject({
  kind: z.literal('initial_request'),
  script: text(10_000),
  requirementsText: text(2_000).optional(),
  voicePresetId: VoicePresetIdSchema,
  assetCount: z.number().int().nonnegative().optional(),
  tags: z.array(ChatTagSchema).max(5),
});

export const FollowUpPayloadSchema = z.strictObject({
  kind: z.literal('follow_up'),
  text: text(2_000),
});

export const UserRequirementPayloadSchema = z.discriminatedUnion('kind', [
  InitialRequestPayloadSchema,
  FollowUpPayloadSchema,
]);

export type UserRequirementPayload = z.infer<typeof UserRequirementPayloadSchema>;

export const UserConfirmationPayloadSchema = z
  .strictObject({
    gate: ApprovalGateSchema,
    decision: ApprovalDecisionKindSchema,
    rawText: text(2_000),
    feedback: text(2_000).optional(),
    artifact: ArtifactReferenceSchema,
    approvalMessageId: IdSchema,
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'request_changes' && value.feedback === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'request_changes requires feedback',
        path: ['feedback'],
      });
    }
  });

export type UserConfirmationPayload = z.infer<typeof UserConfirmationPayloadSchema>;

export const ScriptAnalysisPayloadSchema = z.strictObject({
  brief: CreativeBriefContentSchema,
  briefVersion: z.number().int().positive(),
  contentFingerprint: text(128),
  artifact: ArtifactReferenceSchema,
});

export type ScriptAnalysisPayload = z.infer<typeof ScriptAnalysisPayloadSchema>;

export const ScriptRewriteContentSchema = z.strictObject({
  title: text(120),
  paragraphs: z.array(text(2_000)).min(1).max(20),
  changeNotes: z.array(text(300)).max(20),
});

export type ScriptRewriteContent = z.infer<typeof ScriptRewriteContentSchema>;

export const ScriptRewritePayloadSchema = z.strictObject({
  content: ScriptRewriteContentSchema,
  sourceBrief: ArtifactReferenceSchema,
  rewriteVersion: z.number().int().positive(),
  contentFingerprint: text(128),
});

export type ScriptRewritePayload = z.infer<typeof ScriptRewritePayloadSchema>;

export const SchemeCandidateSchema = z.strictObject({
  id: z.literal('material_edit'),
  label: text(80),
  summary: text(300),
});

export const SchemeRecommendationPayloadSchema = z.strictObject({
  recommendedScheme: z.literal('material_edit'),
  summary: text(600),
  reasons: z.array(text(300)).min(1).max(5),
  candidates: z.array(SchemeCandidateSchema).min(1).max(3),
  sourceBrief: ArtifactReferenceSchema,
  normalizationNotes: z.array(text(300)).max(10),
});

export type SchemeRecommendationPayload = z.infer<typeof SchemeRecommendationPayloadSchema>;

export const ProductionSpecPayloadSchema = z.strictObject({
  spec: ProductionSpecSchema,
  artifact: ArtifactReferenceSchema,
});

export type ProductionSpecPayload = z.infer<typeof ProductionSpecPayloadSchema>;

export const ApprovalRequestPayloadSchema = ApprovalInterruptPayloadSchema;

export type ApprovalRequestPayload = z.infer<typeof ApprovalRequestPayloadSchema>;

export const ExecutionUpdatePayloadSchema = z.strictObject({
  phase: WorkflowPhaseIdSchema,
  nodeId: WorkflowNodeIdSchema.optional(),
  status: ExecutionStatusSchema,
  detail: text(300),
  progress: z
    .strictObject({
      current: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .optional(),
  attempt: z.number().int().positive().optional(),
});

export type ExecutionUpdatePayload = z.infer<typeof ExecutionUpdatePayloadSchema>;

export const VideoOverviewPayloadSchema = z.strictObject({
  title: text(120),
  description: text(600),
  durationSeconds: z.number().int().positive(),
  exportStatus: ExportStatusSchema,
  projectRevision: z.number().int().nonnegative(),
  spec: ArtifactReferenceSchema,
  project: ArtifactReferenceSchema,
  validation: ArtifactReferenceSchema.optional(),
});

export type VideoOverviewPayload = z.infer<typeof VideoOverviewPayloadSchema>;

export const ErrorPayloadSchema = z.strictObject({
  code: text(80),
  message: text(500),
  retryable: z.boolean(),
  fieldPaths: z.array(text(200)).max(20).optional(),
  attempt: z.number().int().positive().optional(),
});

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const SystemNoticePayloadSchema = z.strictObject({
  code: text(80).optional(),
  level: z.enum(['info', 'warning']),
  message: text(500),
});

export type SystemNoticePayload = z.infer<typeof SystemNoticePayloadSchema>;
