import { describe, expect, it } from 'vitest';
import { IpcError, toIpcErrorPayload } from './ipc-error';

describe('toIpcErrorPayload', () => {
  it('keeps standardized domain errors', () => {
    const error = new IpcError('SETTINGS_READ_FAILED', '读取应用设置失败。', true, {
      field: 'settings',
    });

    expect(toIpcErrorPayload(error)).toEqual({
      code: 'SETTINGS_READ_FAILED',
      message: '读取应用设置失败。',
      retryable: true,
      details: { field: 'settings' },
    });
  });

  it('does not leak raw error messages or stacks', () => {
    const payload = toIpcErrorPayload(new Error('secret at C:\\private\\file.ts:42'));

    expect(payload).toEqual({
      code: 'IPC_INTERNAL',
      message: '主进程操作失败，请稍后重试。',
      retryable: false,
    });
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(JSON.stringify(payload)).not.toContain('private');
  });
});
