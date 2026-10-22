import type { IpcErrorCode, IpcErrorPayload } from '../shared/ipc-contract';

export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

/**
 * 只把安全、结构化的错误返回给渲染进程；未知异常统一转成通用错误，
 * 不携带原始 message、stack 或文件路径。
 */
export function toIpcErrorPayload(error: unknown): IpcErrorPayload {
  if (error instanceof IpcError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  return {
    code: 'IPC_INTERNAL',
    message: '主进程操作失败，请稍后重试。',
    retryable: false,
  };
}
