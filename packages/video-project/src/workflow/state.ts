import { z } from 'zod';
import { IdSchema } from '../schema';
import { ArtifactReferenceSchema } from './artifact';
import {
  WORKFLOW_PHASE_IDS,
  WORKFLOW_NODE_IDS,
  WorkflowNodeIdSchema,
  WorkflowPhaseIdSchema,
} from './workflow-definition';

export const WORKFLOW_STATE_SCHEMA_VERSION = '1.0.0' as const;

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'waiting_user',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const WorkflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const WorkflowPhaseStatusSchema = z.strictObject({
  prepare: WorkflowRunStatusSchema,
  storyboard: WorkflowRunStatusSchema,
  voice: WorkflowRunStatusSchema,
  video: WorkflowRunStatusSchema,
});

export type WorkflowPhaseStatus = z.infer<typeof WorkflowPhaseStatusSchema>;

const NullableArtifactReferenceSchema = ArtifactReferenceSchema.nullable();

/**
 * 可序列化的运行状态镜像。
 *
 * LangGraph State 里的 refs 与这里保持一致；运行记录（run.json）和
 * `workflow:get-state` 使用这个 Schema，避免把 LangGraph 内部对象暴露出去。
 */
export const WorkflowArtifactRefsSchema = z.strictObject({
  creationInput: NullableArtifactReferenceSchema,
  assetManifest: NullableArtifactReferenceSchema,
  analyzedAssets: NullableArtifactReferenceSchema,
  creativeBrief: NullableArtifactReferenceSchema,
  productionSpec: NullableArtifactReferenceSchema,
  scenePlan: NullableArtifactReferenceSchema,
  voiceSegments: NullableArtifactReferenceSchema,
  assetMatches: NullableArtifactReferenceSchema,
  videoProject: NullableArtifactReferenceSchema,
  validationReport: NullableArtifactReferenceSchema,
  savedProjectRef: NullableArtifactReferenceSchema,
});

export type WorkflowArtifactRefs = z.infer<typeof WorkflowArtifactRefsSchema>;

export const WorkflowStateSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_STATE_SCHEMA_VERSION),
  projectId: IdSchema,
  runId: IdSchema,
  contentRevision: z.number().int().nonnegative(),
  status: WorkflowRunStatusSchema,
  phaseStatus: WorkflowPhaseStatusSchema,
  currentNodeId: WorkflowNodeIdSchema.nullable(),
  refs: WorkflowArtifactRefsSchema,
  a1ApprovalRef: NullableArtifactReferenceSchema,
  a2ApprovalRef: NullableArtifactReferenceSchema,
  a3ApprovalRef: NullableArtifactReferenceSchema,
  briefFeedback: z.string().trim().max(2_000).nullable(),
  scenePlanFeedback: z.string().trim().max(2_000).nullable(),
  validationPassed: z.boolean(),
  completedNodes: z.array(WorkflowNodeIdSchema).max(WORKFLOW_NODE_IDS.length),
  savedProjectPath: z.string().trim().max(2_000).nullable(),
  lastEventSeq: z.number().int().nonnegative(),
  errors: z.array(z.string().trim().min(1).max(1_000)).max(50),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export function createEmptyPhaseStatus(): WorkflowPhaseStatus {
  return {
    prepare: 'pending',
    storyboard: 'pending',
    voice: 'pending',
    video: 'pending',
  };
}

export function createEmptyArtifactRefs(): WorkflowArtifactRefs {
  return {
    creationInput: null,
    assetManifest: null,
    analyzedAssets: null,
    creativeBrief: null,
    productionSpec: null,
    scenePlan: null,
    voiceSegments: null,
    assetMatches: null,
    videoProject: null,
    validationReport: null,
    savedProjectRef: null,
  };
}

export const WORKFLOW_PHASE_ID_LIST = WORKFLOW_PHASE_IDS;
export { WorkflowPhaseIdSchema };
