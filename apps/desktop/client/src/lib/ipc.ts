import type { IpcErrorPayload, IpcResponse } from '../../../shared/ipc-contract';

export class IpcClientError extends Error {
  constructor(readonly payload: IpcErrorPayload) {
    super(payload.message);
    this.name = 'IpcClientError';
  }
}

export function unwrapIpc<T>(response: IpcResponse<T>): T {
  if (!response.ok) {
    throw new IpcClientError(response.error);
  }

  return response.data;
}
