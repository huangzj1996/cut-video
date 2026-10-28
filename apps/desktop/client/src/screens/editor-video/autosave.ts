/**
 * 编辑器自动保存调度器。
 *
 * 需求：停止编辑 2 秒后自动保存；持续编辑最多 30 秒保存一次；Ctrl+S 立即保存。
 * 冲突时调用方调用 `stop()`，之后不会再自动保存（避免覆盖新修订）。
 *
 * 这里只负责"什么时候保存"，不关心保存内容；保存失败时保留 dirty 状态，
 * 等下一次编辑或手动 flush 再试，避免失败后自动重试风暴。
 */

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 2_000;
export const DEFAULT_AUTOSAVE_MAX_WAIT_MS = 30_000;

export type AutosaveStatus = 'idle' | 'saving';

export interface AutosaveControllerOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  onError?: (error: unknown) => void;
  onStatusChange?: (status: AutosaveStatus) => void;
  save: () => Promise<void>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export class AutosaveController {
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly onStatusChange: ((status: AutosaveStatus) => void) | undefined;
  private readonly save: () => Promise<void>;
  private debounceTimer: TimerHandle | null = null;
  private dirty = false;
  private maxWaitTimer: TimerHandle | null = null;
  private saving: Promise<void> | null = null;
  private stopped = false;

  constructor(options: AutosaveControllerOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_AUTOSAVE_MAX_WAIT_MS;
    this.save = options.save;
    this.onError = options.onError;
    this.onStatusChange = options.onStatusChange;
  }

  get hasUnsavedEdits(): boolean {
    return this.dirty;
  }

  get status(): AutosaveStatus {
    return this.saving ? 'saving' : 'idle';
  }

  /** 每次成功编辑后调用；保存进行中时只标记 dirty，结束后再排一次保存。 */
  noteEdit(): void {
    if (this.stopped) {
      return;
    }

    this.dirty = true;

    if (this.saving) {
      return;
    }

    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSave();
    }, this.debounceMs);

    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        this.clearDebounceTimer();
        void this.runSave();
      }, this.maxWaitMs);
    }
  }

  /** Ctrl+S / 关闭窗口：立即保存，并等待保存完成。 */
  async flush(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.clearTimers();

    if (this.saving) {
      await this.saving;
    }

    if (this.stopped || !this.dirty) {
      return;
    }

    await this.runSave();
  }

  /** 保存冲突：停止自动保存，但保留内存中的编辑。 */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  /** 冲突后重新加载工程：恢复自动保存。 */
  resume(): void {
    this.stopped = false;
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearDebounceTimer();

    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  private scheduleNext(): void {
    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.runSave();
      }, this.debounceMs);
    }

    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        this.clearDebounceTimer();
        void this.runSave();
      }, this.maxWaitMs);
    }
  }

  private runSave(): Promise<void> {
    if (this.stopped || !this.dirty) {
      this.clearTimers();
      return Promise.resolve();
    }

    if (this.saving) {
      return this.saving;
    }

    this.clearTimers();
    // 先清 dirty：保存期间的新编辑会重新置为 true，从而触发下一次保存。
    this.dirty = false;

    const saving = (async () => {
      let succeeded = true;

      this.onStatusChange?.('saving');

      try {
        await this.save();
      } catch (error) {
        succeeded = false;
        this.dirty = true;
        this.onError?.(error);
      } finally {
        this.saving = null;
        this.onStatusChange?.('idle');
      }

      if (succeeded && this.dirty && !this.stopped) {
        this.scheduleNext();
      }
    })();

    this.saving = saving;

    return saving;
  }
}
