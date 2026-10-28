import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveController,
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  DEFAULT_AUTOSAVE_MAX_WAIT_MS,
} from './autosave';

function deferred(): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

describe('AutosaveController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves 2 seconds after the last edit', async () => {
    expect(DEFAULT_AUTOSAVE_DEBOUNCE_MS).toBe(2_000);
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.hasUnsavedEdits).toBe(false);
  });

  it('restarts the debounce window on every edit', async () => {
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(1_000);
    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(1_900);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves at most once every 30 seconds during continuous editing', async () => {
    expect(DEFAULT_AUTOSAVE_MAX_WAIT_MS).toBe(30_000);
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    controller.noteEdit();

    for (let second = 1; second <= 29; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      controller.noteEdit();
    }

    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately and cancels the pending timers', async () => {
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(300);
    await controller.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.hasUnsavedEdits).toBe(false);

    await vi.advanceTimersByTimeAsync(35_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not save when flushed without edits', async () => {
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    await controller.flush();

    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the edits and reports the error when a save fails', async () => {
    const onError = vi.fn();
    const save = vi.fn(() => Promise.reject(new Error('disk full')));
    const controller = new AutosaveController({ onError, save });

    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.hasUnsavedEdits).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not keep autosaving after the editor enters the conflict state', async () => {
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    controller.noteEdit();
    controller.stop();
    await vi.advanceTimersByTimeAsync(35_000);
    await controller.flush();

    expect(save).not.toHaveBeenCalled();
    expect(controller.hasUnsavedEdits).toBe(true);
  });

  it('resumes autosaving after the editor reloads the latest project', async () => {
    const save = vi.fn(() => Promise.resolve());
    const controller = new AutosaveController({ save });

    controller.stop();
    controller.resume();
    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('schedules another save when an edit arrives while a save is in flight', async () => {
    const first = deferred();
    const save = vi.fn(() => first.promise);
    const controller = new AutosaveController({ save });

    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(1);

    controller.noteEdit();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.hasUnsavedEdits).toBe(true);

    save.mockImplementationOnce(() => Promise.resolve());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.hasUnsavedEdits).toBe(false);
  });

  it('exposes a saving status while the request is in flight', async () => {
    const pending = deferred();
    const statuses: string[] = [];
    const controller = new AutosaveController({
      onStatusChange: (status) => statuses.push(status),
      save: () => pending.promise,
    });

    controller.noteEdit();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.status).toBe('saving');

    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.status).toBe('idle');
    expect(statuses).toEqual(['saving', 'idle']);
  });
});
