import { Annotation } from '@langchain/langgraph';
import {
  createEmptyArtifactRefs,
  createEmptyPhaseStatus,
  type ArtifactReference,
  type WorkflowPhaseStatus,
  type WorkflowRunStatus,
  type WorkflowState,
  type WorkflowNodeId,
} from '@miaoma/video-project';

/**
 * LangGraph state 只放引用和状态；完整产物、媒体、消息都在工程目录。
 * 字段与 `WorkflowStateSchema` 一一对应，`toWorkflowState()` 负责映射。
 */
export const WorkflowStateAnnotation = Annotation.Root({
  projectId: Annotation<string>,
  runId: Annotation<string>,
  contentRevision: Annotation<number>,
  creationInputRef: Annotation<ArtifactReference | null>,
  assetManifestRef: Annotation<ArtifactReference | null>,
  analysisRef: Annotation<ArtifactReference | null>,
  briefRef: Annotation<ArtifactReference | null>,
  specRef: Annotation<ArtifactReference | null>,
  scenePlanRef: Annotation<ArtifactReference | null>,
  a1ApprovalRef: Annotation<ArtifactReference | null>,
  a2ApprovalRef: Annotation<ArtifactReference | null>,
  a3ApprovalRef: Annotation<ArtifactReference | null>,
  voiceRef: Annotation<ArtifactReference | null>,
  matchRef: Annotation<ArtifactReference | null>,
  projectRef: Annotation<ArtifactReference | null>,
  validationRef: Annotation<ArtifactReference | null>,
  savedProjectRef: Annotation<ArtifactReference | null>,
  validationPassed: Annotation<boolean>,
  savedProjectPath: Annotation<string | null>,
  briefFeedback: Annotation<string | null>,
  scenePlanFeedback: Annotation<string | null>,
  completedNodes: Annotation<WorkflowNodeId[]>({
    reducer: (left, right) => [...new Set([...left, ...right])],
    default: () => [],
  }),
  status: Annotation<WorkflowRunStatus>,
  phaseStatus: Annotation<WorkflowPhaseStatus>,
  currentNodeId: Annotation<WorkflowNodeId | null>,
  lastEventSeq: Annotation<number>,
  errors: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
});

export type WorkflowGraphState = typeof WorkflowStateAnnotation.State;
export type WorkflowGraphUpdate = typeof WorkflowStateAnnotation.Update;

export interface InitialWorkflowStateInput {
  projectId: string;
  runId: string;
  contentRevision: number;
  creationInputRef: ArtifactReference | null;
  briefFeedback?: string;
  scenePlanFeedback?: string;
}

export function createInitialWorkflowState(input: InitialWorkflowStateInput): WorkflowGraphState {
  return {
    projectId: input.projectId,
    runId: input.runId,
    contentRevision: input.contentRevision,
    creationInputRef: input.creationInputRef,
    assetManifestRef: null,
    analysisRef: null,
    briefRef: null,
    specRef: null,
    scenePlanRef: null,
    a1ApprovalRef: null,
    a2ApprovalRef: null,
    a3ApprovalRef: null,
    voiceRef: null,
    matchRef: null,
    projectRef: null,
    validationRef: null,
    savedProjectRef: null,
    validationPassed: false,
    savedProjectPath: null,
    briefFeedback: input.briefFeedback ?? null,
    scenePlanFeedback: input.scenePlanFeedback ?? null,
    completedNodes: [],
    status: 'pending',
    phaseStatus: createEmptyPhaseStatus(),
    currentNodeId: null,
    lastEventSeq: 0,
    errors: [],
  };
}

export function toWorkflowState(
  state: WorkflowGraphState,
  overrides: Partial<Pick<WorkflowState, 'status' | 'savedProjectPath'>> = {},
): WorkflowState {
  return {
    schemaVersion: '1.0.0',
    projectId: state.projectId,
    runId: state.runId,
    contentRevision: state.contentRevision,
    status: overrides.status ?? state.status,
    phaseStatus: state.phaseStatus,
    currentNodeId: state.currentNodeId,
    refs: {
      ...createEmptyArtifactRefs(),
      creationInput: state.creationInputRef,
      assetManifest: state.assetManifestRef,
      analyzedAssets: state.analysisRef,
      creativeBrief: state.briefRef,
      productionSpec: state.specRef,
      scenePlan: state.scenePlanRef,
      voiceSegments: state.voiceRef,
      assetMatches: state.matchRef,
      videoProject: state.projectRef,
      validationReport: state.validationRef,
      savedProjectRef: state.savedProjectRef,
    },
    a1ApprovalRef: state.a1ApprovalRef,
    a2ApprovalRef: state.a2ApprovalRef,
    a3ApprovalRef: state.a3ApprovalRef,
    briefFeedback: state.briefFeedback,
    scenePlanFeedback: state.scenePlanFeedback,
    validationPassed: state.validationPassed,
    completedNodes: state.completedNodes,
    savedProjectPath: overrides.savedProjectPath ?? state.savedProjectPath,
    lastEventSeq: state.lastEventSeq,
    errors: state.errors,
  };
}
