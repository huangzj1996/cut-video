import { describe, expect, it } from 'vitest';
import { IpcClientError, unwrapIpc } from './ipc';

describe('unwrapIpc', () => {
  it('returns data from a successful response', () => {
    expect(unwrapIpc({ ok: true, data: 42 })).toBe(42);
  });

  it('throws a standardized client error from a failed response', () => {
    const response = {
      ok: false as const,
      error: {
        code: 'IPC_INTERNAL' as const,
        message: '主进程操作失败，请稍后重试。',
        retryable: false,
      },
    };

    try {
      unwrapIpc(response);
      throw new Error('expected unwrapIpc to throw');
    } catch (caught) {
      expect(caught).toBeInstanceOf(IpcClientError);
      expect((caught as IpcClientError).payload).toEqual(response.error);
    }
  });
});
