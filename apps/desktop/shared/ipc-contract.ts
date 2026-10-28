/**
 * IPC 契约唯一来源。
 *
 * 命名规范：`模块:动作`，动作使用 kebab-case，例如 `app:get-info`。
 * 每个通道只承担一个职责，不把应用信息、设置、媒体探测混在一起。
 *
 * 新增通道顺序：
 * 1. 在 `IpcInvokeContract` 中声明 params/result；
 * 2. 在 `IPC_CHANNELS` 中登记模块与动作；
 * 3. 主进程用 `handle()` 注册，Preload 用 `invoke()` 暴露。
 */

import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalInterruptPayload,
  ArtifactReference,
  ChatMessage,
  ChatStreamEvent,
  CreationInputDraft,
  RunEvent,
  StoredProject,
  VoicePresetId,
  WorkflowNodeId,
  WorkflowPhaseStatus,
  WorkflowRunStatus,
} from '@miaoma/video-project';

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
  arch: string;
}

export interface AppSettings {
  defaultProjectDirectory: string;
}

export interface MediaInfo {
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegExists: boolean;
  ffprobeExists: boolean;
}

export interface MediaReadAudioInput {
  assetId: string;
  projectId: string;
}

/** 波形解码所需的音频字节；base64 避免 contextBridge 传递类型化数组的兼容问题。 */
export interface MediaReadAudioResult {
  assetId: string;
  base64: string;
  mimeType: string;
}

export interface ProjectSummary {
  contentRevision: number;
  createdAt: string;
  isDraft: boolean;
  name: string;
  projectId: string;
  schemaVersion: string;
  updatedAt: string;
}

export interface ProjectCreateInput {
  assetPath?: string;
  name: string;
  creation?: CreationInputDraft;
}

export interface ProjectUpdateInput {
  /** 编辑器保存时的基线修订号；不匹配返回 PROJECT_STALE_REVISION。 */
  expectedRevision?: number;
  project: StoredProject;
  projectId: string;
}

export interface ProjectDeleteResult {
  deleted: true;
  projectId: string;
}

export interface LlmChatMessage {
  content: string;
  role: 'system' | 'user' | 'assistant';
}

export interface LlmChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmChatResult {
  model: string;
  reply: string;
  usage?: LlmChatUsage;
}

/** 渲染进程可见的创作输入；不包含本地素材绝对路径。 */
export interface PublicCreationInput {
  createdAt: string;
  requirementsText?: string;
  script: string;
  voicePresetId: VoicePresetId;
}

export interface WorkflowPublicState {
  contentRevision: number;
  currentNodeId: WorkflowNodeId | null;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  lastEventSeq: number;
  pendingApproval?: ApprovalInterruptPayload;
  pendingGate?: ApprovalGate;
  phaseStatus: WorkflowPhaseStatus;
  runId: string;
  saved: boolean;
  status: WorkflowRunStatus;
}

export interface ChatListResult {
  creation: PublicCreationInput | null;
  messages: ChatMessage[];
  projectName: string;
  workflow: WorkflowPublicState | null;
}

export interface ChatActionResult {
  messages: ChatMessage[];
  workflow: WorkflowPublicState | null;
}

export interface ChatSendInput {
  projectId: string;
  text: string;
}

export interface WorkflowResumeInput {
  decision?: ApprovalDecision;
  projectId: string;
  runId: string;
}

export interface WorkflowCancelInput {
  projectId: string;
  runId: string;
}

export interface WorkflowArtifactInput {
  projectId: string;
  reference: ArtifactReference;
}

export type WorkflowArtifactPayload = Record<string, unknown>;

export interface IpcEventContract {
  'chat:message': ChatMessage;
  'chat:stream': ChatStreamEvent;
  'editor:flush-request': null;
  'workflow:event': RunEvent;
}

export type IpcEventChannel = keyof IpcEventContract;

export type IpcErrorCode =
  | 'IPC_INVALID_ARGUMENT'
  | 'IPC_UNAVAILABLE'
  | 'IPC_INTERNAL'
  | 'SETTINGS_READ_FAILED'
  | 'MEDIA_INFO_FAILED'
  | 'PROJECT_INVALID_ARGUMENT'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INVALID'
  | 'PROJECT_SCHEMA_UNSUPPORTED'
  | 'PROJECT_READ_FAILED'
  | 'PROJECT_WRITE_FAILED'
  | 'PROJECT_DELETE_FAILED'
  | 'PROJECT_LIST_FAILED'
  | 'PROJECT_CREATION_MISSING'
  | 'PROJECT_STALE_REVISION'
  | 'ASSET_INVALID_ARGUMENT'
  | 'ASSET_SCAN_FAILED'
  | 'ASSET_PATH_NOT_FOUND'
  | 'ASSET_NO_VIDEOS'
  | 'ASSET_PROBE_FAILED'
  | 'ASSET_PROBE_UNAVAILABLE'
  | 'ASSET_KEYFRAME_UNAVAILABLE'
  | 'ASSET_MANIFEST_WRITE_FAILED'
  | 'MEDIA_AUDIO_NOT_FOUND'
  | 'MEDIA_AUDIO_TOO_LARGE'
  | 'MEDIA_AUDIO_READ_FAILED'
  | 'LLM_INVALID_ARGUMENT'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_REQUEST_FAILED'
  | 'WORKFLOW_INVALID_ARGUMENT'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_BUSY'
  | 'WORKFLOW_APPROVAL_REQUIRED'
  | 'WORKFLOW_STALE_APPROVAL'
  | 'WORKFLOW_STALE_RESULT'
  | 'WORKFLOW_CHECKPOINT_INCOMPATIBLE'
  | 'WORKFLOW_ARTIFACT_INVALID'
  | 'CHAT_INVALID_ARGUMENT'
  | 'CHAT_CONTEXT_MISSING'
  | 'CHAT_APPROVAL_NOT_FOUND'
  | 'CHAT_LOG_INVALID'
  | 'CHAT_LOG_TOO_LARGE'
  | 'CHAT_WRITE_FAILED';

export interface IpcErrorPayload {
  code: IpcErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type IpcResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: IpcErrorPayload;
    };

export interface IpcInvokeContract {
  'app:ping': {
    params: [];
    result: 'pong';
  };
  'app:get-info': {
    params: [];
    result: AppInfo;
  };
  'settings:get': {
    params: [];
    result: AppSettings;
  };
  'media:get-info': {
    params: [];
    result: MediaInfo;
  };
  'media:read-audio': {
    params: [input: MediaReadAudioInput];
    result: MediaReadAudioResult;
  };
  'project:list': {
    params: [];
    result: ProjectSummary[];
  };
  'project:get': {
    params: [projectId: string];
    result: StoredProject;
  };
  'project:create': {
    params: [input: ProjectCreateInput];
    result: StoredProject;
  };
  'project:update': {
    params: [input: ProjectUpdateInput];
    result: StoredProject;
  };
  'project:delete': {
    params: [projectId: string];
    result: ProjectDeleteResult;
  };
  'project:select-assets': {
    params: [projectId: string];
    result: { selected: boolean };
  };
  'editor:flush-complete': {
    params: [];
    result: null;
  };
  'llm:chat': {
    params: [messages: LlmChatMessage[]];
    result: LlmChatResult;
  };
  'chat:list': {
    params: [projectId: string];
    result: ChatListResult;
  };
  'chat:start': {
    params: [projectId: string];
    result: ChatActionResult;
  };
  'chat:send': {
    params: [input: ChatSendInput];
    result: ChatActionResult;
  };
  'chat:retry': {
    params: [projectId: string];
    result: ChatActionResult;
  };
  'workflow:get-state': {
    params: [projectId: string];
    result: WorkflowPublicState | null;
  };
  'workflow:resume': {
    params: [input: WorkflowResumeInput];
    result: WorkflowPublicState;
  };
  'workflow:cancel': {
    params: [input: WorkflowCancelInput];
    result: WorkflowPublicState;
  };
  'workflow:get-artifact': {
    params: [input: WorkflowArtifactInput];
    result: WorkflowArtifactPayload;
  };
}

export type IpcChannel = keyof IpcInvokeContract;
export type IpcParams<C extends IpcChannel> = IpcInvokeContract[C]['params'];
export type IpcResult<C extends IpcChannel> = IpcInvokeContract[C]['result'];
export type IpcHandler<C extends IpcChannel> = (
  ...params: IpcParams<C>
) => IpcResult<C> | Promise<IpcResult<C>>;
export type IpcInvoke = <C extends IpcChannel>(
  channel: C,
  ...params: IpcParams<C>
) => Promise<IpcResponse<IpcResult<C>>>;

export const IPC_CHANNELS = {
  app: {
    ping: 'app:ping' satisfies IpcChannel,
    getInfo: 'app:get-info' satisfies IpcChannel,
  },
  settings: {
    get: 'settings:get' satisfies IpcChannel,
  },
  media: {
    getInfo: 'media:get-info' satisfies IpcChannel,
    readAudio: 'media:read-audio' satisfies IpcChannel,
  },
  project: {
    create: 'project:create' satisfies IpcChannel,
    delete: 'project:delete' satisfies IpcChannel,
    get: 'project:get' satisfies IpcChannel,
    list: 'project:list' satisfies IpcChannel,
    selectAssets: 'project:select-assets' satisfies IpcChannel,
    update: 'project:update' satisfies IpcChannel,
  },
  llm: {
    chat: 'llm:chat' satisfies IpcChannel,
  },
  editor: {
    flushComplete: 'editor:flush-complete' satisfies IpcChannel,
  },
  chat: {
    list: 'chat:list' satisfies IpcChannel,
    retry: 'chat:retry' satisfies IpcChannel,
    send: 'chat:send' satisfies IpcChannel,
    start: 'chat:start' satisfies IpcChannel,
  },
  workflow: {
    cancel: 'workflow:cancel' satisfies IpcChannel,
    getArtifact: 'workflow:get-artifact' satisfies IpcChannel,
    getState: 'workflow:get-state' satisfies IpcChannel,
    resume: 'workflow:resume' satisfies IpcChannel,
  },
} as const satisfies Record<string, Record<string, IpcChannel>>;

export const IPC_EVENT_CHANNELS = {
  chatMessage: 'chat:message' satisfies IpcEventChannel,
  chatStream: 'chat:stream' satisfies IpcEventChannel,
  editorFlushRequest: 'editor:flush-request' satisfies IpcEventChannel,
  workflowEvent: 'workflow:event' satisfies IpcEventChannel,
} as const;

export interface MiaomaProjectApi {
  list(): Promise<IpcResponse<IpcResult<'project:list'>>>;
  get(projectId: string): Promise<IpcResponse<IpcResult<'project:get'>>>;
  create(input: ProjectCreateInput): Promise<IpcResponse<IpcResult<'project:create'>>>;
  update(input: ProjectUpdateInput): Promise<IpcResponse<IpcResult<'project:update'>>>;
  delete(projectId: string): Promise<IpcResponse<IpcResult<'project:delete'>>>;
  selectAssets(projectId: string): Promise<IpcResponse<IpcResult<'project:select-assets'>>>;
}

export interface MiaomaLlmApi {
  chat(messages: LlmChatMessage[]): Promise<IpcResponse<IpcResult<'llm:chat'>>>;
}

export interface MiaomaMediaApi {
  readAudio(input: MediaReadAudioInput): Promise<IpcResponse<IpcResult<'media:read-audio'>>>;
}

export interface MiaomaChatApi {
  list(projectId: string): Promise<IpcResponse<IpcResult<'chat:list'>>>;
  start(projectId: string): Promise<IpcResponse<IpcResult<'chat:start'>>>;
  send(input: ChatSendInput): Promise<IpcResponse<IpcResult<'chat:send'>>>;
  retry(projectId: string): Promise<IpcResponse<IpcResult<'chat:retry'>>>;
  onMessage(listener: (message: ChatMessage) => void): () => void;
  onStream(listener: (event: ChatStreamEvent) => void): () => void;
}

export interface MiaomaWorkflowApi {
  getState(projectId: string): Promise<IpcResponse<IpcResult<'workflow:get-state'>>>;
  resume(input: WorkflowResumeInput): Promise<IpcResponse<IpcResult<'workflow:resume'>>>;
  cancel(input: WorkflowCancelInput): Promise<IpcResponse<IpcResult<'workflow:cancel'>>>;
  getArtifact(
    input: WorkflowArtifactInput,
  ): Promise<IpcResponse<IpcResult<'workflow:get-artifact'>>>;
  onEvent(listener: (event: RunEvent) => void): () => void;
}

/** 关闭窗口前的 flush 握手：主进程请求，渲染进程保存完成后确认。 */
export interface MiaomaEditorApi {
  onFlushRequest(listener: () => void): () => void;
  completeFlush(): Promise<IpcResponse<IpcResult<'editor:flush-complete'>>>;
}

export interface MiaomaApi {
  ping(): Promise<IpcResponse<IpcResult<'app:ping'>>>;
  getAppInfo(): Promise<IpcResponse<IpcResult<'app:get-info'>>>;
  getSettings(): Promise<IpcResponse<IpcResult<'settings:get'>>>;
  getMediaInfo(): Promise<IpcResponse<IpcResult<'media:get-info'>>>;
  media: MiaomaMediaApi;
  project: MiaomaProjectApi;
  llm: MiaomaLlmApi;
  chat: MiaomaChatApi;
  workflow: MiaomaWorkflowApi;
  editor: MiaomaEditorApi;
}
