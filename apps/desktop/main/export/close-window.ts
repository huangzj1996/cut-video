/**
 * 导出进行中的关窗流程。
 *
 * 用户点关闭时先确认（导出会因此被取消）；确认后请求取消，最多等 5 秒让
 * ffmpeg 退出并清理临时产物，超时也不再阻塞关窗。随后照常走编辑器 flush
 * 握手并销毁窗口。取消导出永远不提交成品。
 */
export const EXPORT_CLOSE_WAIT_MS = 5_000;

export interface CloseWindowWithExportDeps {
  /** 弹确认框；true 表示“取消导出并关闭”，false 表示“继续导出”。 */
  confirmStopExport: () => Promise<boolean>;
  exportActive: () => boolean;
  requestCancel: () => void;
  waitForExport: () => Promise<void>;
  waitForFlush: () => Promise<void>;
  destroy: () => void;
}

/** 等到 promise 结束或超时，两者谁先到都 resolve；不抛错。 */
export function waitWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);

    // 兜底：定时器不该让进程保持存活。
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    promise.then(finish, finish);
  });
}

/**
 * 执行关窗：有导出时先确认并取消（最多等 EXPORT_CLOSE_WAIT_MS），再 flush 编辑器。
 * 用户选择继续导出时直接返回，不关窗、不 flush。
 */
export async function closeWindowWithExport(deps: CloseWindowWithExportDeps): Promise<void> {
  if (deps.exportActive()) {
    const shouldClose = await deps.confirmStopExport();

    if (!shouldClose) {
      return;
    }

    deps.requestCancel();
    await waitWithTimeout(deps.waitForExport(), EXPORT_CLOSE_WAIT_MS);
  }

  await deps.waitForFlush();
  deps.destroy();
}
