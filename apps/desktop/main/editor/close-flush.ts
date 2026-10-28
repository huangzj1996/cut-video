/**
 * 关闭窗口前的 flush 握手。
 *
 * 主进程拦截 `close`，向渲染进程发送 flush 请求；渲染进程把未保存的编辑
 * 保存完后回调 `editor:flush-complete`。最多等待 2 秒，超时或请求无法送达
 * 时直接放行关闭，避免用户卡在关不掉的窗口。
 */
export const DEFAULT_CLOSE_FLUSH_TIMEOUT_MS = 2_000;

export interface CloseFlushOptions {
  requestFlush: () => void;
  timeoutMs?: number;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export class CloseFlushCoordinator {
  private readonly requestFlush: () => void;
  private readonly timeoutMs: number;
  private pending: Promise<void> | null = null;
  private resolvePending: (() => void) | null = null;
  private timer: TimerHandle | null = null;

  constructor(options: CloseFlushOptions) {
    this.requestFlush = options.requestFlush;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CLOSE_FLUSH_TIMEOUT_MS;
  }

  /** 开始（或复用）一次握手；返回的 Promise 在收到确认或超时后 resolve。 */
  begin(): Promise<void> {
    if (this.pending) {
      return this.pending;
    }

    const pending = new Promise<void>((resolve) => {
      this.resolvePending = resolve;
    });

    this.pending = pending;
    this.timer = setTimeout(() => {
      this.finish();
    }, this.timeoutMs);

    try {
      this.requestFlush();
    } catch {
      this.finish();
    }

    return pending;
  }

  /** 渲染进程完成 flush 后调用；没有进行中的握手时是 no-op。 */
  complete(): void {
    this.finish();
  }

  private finish(): void {
    const resolve = this.resolvePending;

    if (!resolve) {
      return;
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.resolvePending = null;
    this.pending = null;
    resolve();
  }
}
