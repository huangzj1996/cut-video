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

export type IpcErrorCode =
  | 'IPC_INVALID_ARGUMENT'
  | 'IPC_UNAVAILABLE'
  | 'IPC_INTERNAL'
  | 'SETTINGS_READ_FAILED'
  | 'MEDIA_INFO_FAILED';

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
} as const satisfies Record<string, Record<string, IpcChannel>>;

export interface MiaomaApi {
  ping(): Promise<IpcResponse<IpcResult<'app:ping'>>>;
  getAppInfo(): Promise<IpcResponse<IpcResult<'app:get-info'>>>;
  getSettings(): Promise<IpcResponse<IpcResult<'settings:get'>>>;
  getMediaInfo(): Promise<IpcResponse<IpcResult<'media:get-info'>>>;
}
