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

import type { StoredProject } from '@miaoma/video-project';

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

export interface ProjectSummary {
  contentRevision: number;
  createdAt: string;
  name: string;
  projectId: string;
  schemaVersion: string;
  updatedAt: string;
}

export interface ProjectCreateInput {
  assetPath?: string;
  name: string;
}

export interface ProjectUpdateInput {
  project: StoredProject;
  projectId: string;
}

export interface ProjectDeleteResult {
  deleted: true;
  projectId: string;
}

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
  | 'ASSET_INVALID_ARGUMENT'
  | 'ASSET_SCAN_FAILED'
  | 'ASSET_PATH_NOT_FOUND'
  | 'ASSET_NO_VIDEOS'
  | 'ASSET_PROBE_FAILED'
  | 'ASSET_PROBE_UNAVAILABLE'
  | 'ASSET_MANIFEST_WRITE_FAILED';

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
  },
  project: {
    create: 'project:create' satisfies IpcChannel,
    delete: 'project:delete' satisfies IpcChannel,
    get: 'project:get' satisfies IpcChannel,
    list: 'project:list' satisfies IpcChannel,
    update: 'project:update' satisfies IpcChannel,
  },
} as const satisfies Record<string, Record<string, IpcChannel>>;

export interface MiaomaProjectApi {
  list(): Promise<IpcResponse<IpcResult<'project:list'>>>;
  get(projectId: string): Promise<IpcResponse<IpcResult<'project:get'>>>;
  create(input: ProjectCreateInput): Promise<IpcResponse<IpcResult<'project:create'>>>;
  update(input: ProjectUpdateInput): Promise<IpcResponse<IpcResult<'project:update'>>>;
  delete(projectId: string): Promise<IpcResponse<IpcResult<'project:delete'>>>;
}

export interface MiaomaApi {
  ping(): Promise<IpcResponse<IpcResult<'app:ping'>>>;
  getAppInfo(): Promise<IpcResponse<IpcResult<'app:get-info'>>>;
  getSettings(): Promise<IpcResponse<IpcResult<'settings:get'>>>;
  getMediaInfo(): Promise<IpcResponse<IpcResult<'media:get-info'>>>;
  project: MiaomaProjectApi;
}
