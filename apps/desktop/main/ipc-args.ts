import { IpcError } from './ipc-error';

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** 主进程 IPC/服务边界共用的工程 ID 校验。 */
export function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目 ID 无效。');
  }

  return value;
}
