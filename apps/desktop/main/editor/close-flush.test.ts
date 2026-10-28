import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseFlushCoordinator, DEFAULT_CLOSE_FLUSH_TIMEOUT_MS } from './close-flush';

describe('CloseFlushCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the renderer to flush and only resolves after the acknowledgement', async () => {
    const requestFlush = vi.fn();
    const coordinator = new CloseFlushCoordinator({ requestFlush });
    let finished = false;

    const done = coordinator.begin().then(() => {
      finished = true;
    });

    expect(requestFlush).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(finished).toBe(false);

    coordinator.complete();
    await done;

    expect(finished).toBe(true);
  });

  it('closes after the 2 second timeout when the renderer never acknowledges', async () => {
    expect(DEFAULT_CLOSE_FLUSH_TIMEOUT_MS).toBe(2_000);
    const requestFlush = vi.fn();
    const coordinator = new CloseFlushCoordinator({ requestFlush });
    let finished = false;

    const done = coordinator.begin().then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(finished).toBe(true);
  });

  it('keeps a single handshake when close is requested repeatedly', async () => {
    const requestFlush = vi.fn();
    const coordinator = new CloseFlushCoordinator({ requestFlush });

    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(second).toBe(first);
    expect(requestFlush).toHaveBeenCalledTimes(1);

    coordinator.complete();
    await first;
  });

  it('ignores an acknowledgement that arrives before any close request', () => {
    const coordinator = new CloseFlushCoordinator({ requestFlush: vi.fn() });

    expect(() => coordinator.complete()).not.toThrow();
  });

  it('starts a fresh handshake after the previous one finished', async () => {
    const requestFlush = vi.fn();
    const coordinator = new CloseFlushCoordinator({ requestFlush });

    const first = coordinator.begin();
    coordinator.complete();
    await first;

    const second = coordinator.begin();
    coordinator.complete();
    await second;

    expect(requestFlush).toHaveBeenCalledTimes(2);
  });

  it('closes immediately when the flush request cannot be delivered', async () => {
    const coordinator = new CloseFlushCoordinator({
      requestFlush: () => {
        throw new Error('window destroyed');
      },
    });

    await expect(coordinator.begin()).resolves.toBeUndefined();
  });
});
