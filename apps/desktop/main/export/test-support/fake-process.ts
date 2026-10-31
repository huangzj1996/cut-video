import type { ExportProcessHandle, ExportProcessResult } from '../runner';

/**
 * 可脚本化的渲染进程句柄：测试用它控制“何时退出、取消时是否优雅退出、是否被强杀”。
 */
export interface FakeProcessOptions {
  /** 非空时立即以该结果结束。 */
  autoExit?: ExportProcessResult | null;
  /** 非空时在收到 q（requestQuit）后以该结果结束。 */
  exitOnQuit?: ExportProcessResult | null;
  onKill?: () => void;
  onQuit?: () => void;
  pid?: number;
}

export interface FakeProcess extends ExportProcessHandle {
  /** 手动决定进程何时退出。 */
  resolve(result: ExportProcessResult): void;
  readonly killCount: number;
  readonly quitCount: number;
}

export function okProcess(): ExportProcessResult {
  return { exitCode: 0, stderrTail: '' };
}

export function createFakeProcess(options: FakeProcessOptions = {}): FakeProcess {
  let resolveExit: (result: ExportProcessResult) => void = () => undefined;
  const exited = new Promise<ExportProcessResult>((resolve) => {
    resolveExit = resolve;
  });
  let killCount = 0;
  let quitCount = 0;

  if (options.autoExit) {
    resolveExit(options.autoExit);
  }

  const process: FakeProcess = {
    exited,
    get killCount() {
      return killCount;
    },
    killTree: () => {
      killCount += 1;
      options.onKill?.();
    },
    pid: options.pid ?? 4242,
    get quitCount() {
      return quitCount;
    },
    requestQuit: () => {
      quitCount += 1;
      options.onQuit?.();

      if (options.exitOnQuit) {
        resolveExit(options.exitOnQuit);
      }
    },
    resolve: (result) => {
      resolveExit(result);
    },
  };

  return process;
}
