import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWindowWithExport, EXPORT_CLOSE_WAIT_MS, waitWithTimeout } from './close-window';

afterEach(() => {
  vi.useRealTimers();
});

interface Calls {
  cancel: () => void;
  confirm: () => Promise<boolean>;
  destroy: () => void;
  flush: () => Promise<void>;
  idle: () => Promise<void>;
  isActive: () => boolean;
}

function createDeps(overrides: Partial<Calls> = {}): { calls: string[]; deps: Calls } {
  const calls: string[] = [];
  const deps: Calls = {
    cancel: () => {
      calls.push('cancel');
    },
    confirm: async () => {
      calls.push('confirm');
      return true;
    },
    destroy: () => {
      calls.push('destroy');
    },
    flush: async () => {
      calls.push('flush');
    },
    idle: async () => {
      calls.push('idle');
    },
    isActive: () => true,
    ...overrides,
  };

  return { calls, deps };
}

function close(deps: Calls): Promise<void> {
  return closeWindowWithExport({
    confirmStopExport: deps.confirm,
    destroy: deps.destroy,
    exportActive: deps.isActive,
    requestCancel: deps.cancel,
    waitForExport: deps.idle,
    waitForFlush: deps.flush,
  });
}

describe('export-aware window close', () => {
  it('flushes and destroys the window directly when no export is running', async () => {
    const { calls, deps } = createDeps({ isActive: () => false });

    await close(deps);

    expect(calls).toEqual(['flush', 'destroy']);
  });

  it('keeps the window open when the user chooses to keep exporting', async () => {
    const { calls, deps } = createDeps({
      confirm: async () => {
        calls.push('confirm');
        return false;
      },
    });

    await close(deps);

    expect(calls).toEqual(['confirm']);
  });

  it('cancels the export, waits for it, then flushes and destroys', async () => {
    const { calls, deps } = createDeps();

    await close(deps);

    expect(calls).toEqual(['confirm', 'cancel', 'idle', 'flush', 'destroy']);
  });

  it('stops waiting for the export after five seconds and still closes', async () => {
    vi.useFakeTimers();
    const { calls, deps } = createDeps({
      idle: () => {
        calls.push('idle');
        return new Promise<void>(() => undefined);
      },
    });

    const pending = close(deps);

    await vi.advanceTimersByTimeAsync(EXPORT_CLOSE_WAIT_MS + 10);
    await pending;

    expect(EXPORT_CLOSE_WAIT_MS).toBe(5_000);
    expect(calls).toEqual(['confirm', 'cancel', 'idle', 'flush', 'destroy']);
  });

  it('resolves as soon as the awaited promise finishes, even before the timeout', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const pending = waitWithTimeout(Promise.resolve(), 5_000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    await pending;

    expect(resolved).toBe(true);
  });
});
