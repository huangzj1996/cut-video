import type { z } from 'zod';
import type {
  ApprovalGate,
  ApprovalInterruptPayload,
  ArtifactKind,
  ArtifactReference,
  AssetManifest,
  CreationInput,
  ProjectAssets,
  RunEvent,
  ScriptAnalysisDraft,
  StoredProject,
  VideoProject,
  WorkflowNodeId,
  WorkflowPhaseId,
  WorkflowPhaseStatus,
  WorkflowRunStatus,
  WorkflowState,
} from '@miaoma/video-project';
import type { LlmProvider } from '../llm/types';
import type { WorkflowGraphState, WorkflowGraphUpdate } from './state';
import type { SafeWorkflowError } from './errors';

export interface ArtifactWriteOptions<T> {
  kind: ArtifactKind;
  data: T;
  schema: z.ZodType<T>;
  /** 工程内相对路径，例如 analysis/brief/creative-brief.v1.json */
  fileName: string;
  version: number;
  /**
   * 幂等复用键，通常是节点输入指纹。命中且文件存在时直接返回已有 ref，
   * 不重写文件、不重复发 artifact.written。
   */
  cacheKey?: string;
}

export interface ArtifactWriteResult {
  reference: ArtifactReference;
  created: boolean;
}

export interface ArtifactStore {
  readonly projectDirectory: string;
  write<T>(options: ArtifactWriteOptions<T>): Promise<ArtifactWriteResult>;
  read<T>(reference: ArtifactReference, schema: z.ZodType<T>): Promise<T>;
  findReusable(kind: ArtifactKind, cacheKey: string): Promise<ArtifactReference | null>;
  findLatest(kind: ArtifactKind): Promise<ArtifactReference | null>;
  writeFile(relativePath: string, data: string | Uint8Array): Promise<string>;
  resolve(relativePath: string): string;
}

export interface AssetScanProgress {
  current: number;
  total: number;
  detail?: string;
}

export interface AssetScanRequest {
  projectId: string;
  assetPath?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AssetScanProgress) => void;
}

export interface AssetScanPort {
  scanAssets(request: AssetScanRequest): Promise<AssetManifest>;
}

export interface ProjectPort {
  getDirectory(projectId: string): string;
  read(projectId: string): StoredProject;
  readCreationInput(projectId: string): CreationInput;
  replaceAssets(projectId: string, assets: ProjectAssets): StoredProject;
  save(projectId: string, project: VideoProject, expectedRevision: number): StoredProject;
}

export const PROMPT_NAMES = ['creative-brief', 'script-analysis', 'plan-scenes'] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export interface PromptTemplate {
  system: string;
  user: string;
}

export interface PromptProvider {
  get(name: PromptName): PromptTemplate;
}

export interface WorkflowLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  message?: string;
  nodeId?: WorkflowNodeId;
  phase?: WorkflowPhaseId;
  attempt?: number;
  durationMs?: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface WorkflowLogger {
  log(entry: WorkflowLogEntry): void;
}

export type RunEventInput = Omit<
  RunEvent,
  'schemaVersion' | 'runId' | 'projectId' | 'seq' | 'timestamp'
>;

export interface RunEventSink {
  readonly lastSeq: number;
  emit(event: RunEventInput): RunEvent;
}

/** 流式渲染快照；由节点上报，不进入 checkpoint / events.jsonl。 */
export interface ScriptAnalysisStreamChunk {
  attempt: number;
  done: boolean;
  draft: ScriptAnalysisDraft;
  streamId: string;
}

export interface ScriptAnalysisStreamPort {
  publish(chunk: ScriptAnalysisStreamChunk): void;
}

export interface WorkflowServices {
  readonly projectId: string;
  readonly runId: string;
  readonly contentRevision: number;
  readonly projectDirectory: string;
  readonly artifacts: ArtifactStore;
  readonly assets: AssetScanPort;
  readonly projects: ProjectPort;
  readonly prompts: PromptProvider;
  readonly llm: LlmProvider;
  readonly events: RunEventSink;
  readonly streams: ScriptAnalysisStreamPort;
  readonly logger: WorkflowLogger;
  readonly signal?: AbortSignal;
  readonly now: () => Date;
  readonly newId: () => string;
}

export interface NodeContext {
  readonly projectId: string;
  readonly runId: string;
  readonly contentRevision: number;
  readonly projectDirectory: string;
  readonly artifacts: ArtifactStore;
  readonly assets: AssetScanPort;
  readonly projects: ProjectPort;
  readonly prompts: PromptProvider;
  readonly llm: LlmProvider;
  readonly streams: ScriptAnalysisStreamPort;
  readonly signal?: AbortSignal;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly logger: WorkflowLogger;
  readonly lastSeq: () => number;
  writeArtifact<T>(options: ArtifactWriteOptions<T>): Promise<ArtifactReference>;
  readArtifact<T>(reference: ArtifactReference, schema: z.ZodType<T>): Promise<T>;
  findArtifact(kind: ArtifactKind, cacheKey: string): Promise<ArtifactReference | null>;
  emitProgress(progress: AssetScanProgress): void;
  interrupt<T>(payload: ApprovalInterruptPayload, responseSchema: z.ZodType<T>): T;
  throwIfAborted(): void;
}

export interface WorkflowNodeSpec<TInput, TOutput> {
  id: WorkflowNodeId;
  phase: WorkflowPhaseId;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  loadInput(state: WorkflowGraphState, ctx: NodeContext): Promise<TInput>;
  execute(input: TInput, ctx: NodeContext): Promise<TOutput>;
  persist(output: TOutput, ctx: NodeContext): Promise<WorkflowGraphUpdate>;
}

export type AnyWorkflowNodeSpec = WorkflowNodeSpec<unknown, unknown>;

export interface WorkflowRunSnapshot {
  runId: string;
  status: WorkflowRunStatus;
  state: WorkflowState;
  pendingGate?: ApprovalGate;
  pendingApproval?: ApprovalInterruptPayload;
  error?: SafeWorkflowError;
}

export interface PhaseStatusUpdate {
  phaseStatus: WorkflowPhaseStatus;
  completedNodes?: WorkflowNodeId[];
}

export type NodeRunStatus = WorkflowRunStatus;
