import { spawn, type ChildProcess } from 'node:child_process';

const MAX_STDERR_TAIL_BYTES = 8 * 1024;

export interface ExportProcessRequest {
  args: string[];
  command: string;
  cwd?: string;
  onStderrChunk?: (chunk: string) => void;
  onStdoutChunk?: (chunk: string) => void;
}

export interface ExportProcessResult {
  exitCode: number | null;
  spawnError?: string;
  stderrTail: string;
}

/**
 * 渲染进程句柄：任务用它请求优雅退出或超时强杀。
 *
 * 取消的第一选择是向 stdin 写 `q`（ffmpeg 的交互退出命令，会写完文件头再退出）；
 * 只有优雅退出超时才动用进程树强杀。spawn 失败时也返回一个已结束的句柄，
 * 让调用方不必区分“启动失败”和“进程很快退出”。
 */
export interface ExportProcessHandle {
  readonly exited: Promise<ExportProcessResult>;
  readonly pid: number | undefined;
  /** 向 ffmpeg 的 stdin 写 q；进程已退出或没有 stdin 时是 no-op。 */
  requestQuit(): void;
  /** 强制结束整棵进程树（Windows 用 taskkill /T /F）。 */
  killTree(): void;
}

export type ExportProcessRunner = (request: ExportProcessRequest) => ExportProcessHandle;

/**
 * 强杀进程树：ffmpeg 可能还有子进程，Windows 上 `child.kill()` 不保证带走它们。
 * 用 taskkill /T /F（/T = 结束子进程，/F = 强制结束）；其他平台退回 child.kill。
 */
function forceKill(child: ChildProcess): void {
  try {
    child.kill('SIGKILL');
  } catch {
    // 进程已经退出时 kill 失败没有影响。
  }
}

function killProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) {
    return;
  }

  if (process.platform === 'win32' && child.pid !== undefined) {
    let killer: ChildProcess;

    try {
      killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      forceKill(child);
      return;
    }

    // spawn 的失败是异步 error 事件，不会走上面的 catch：taskkill 没跑起来或
    // 执行失败（非 0 退出码）时退回 child.kill，保证“强制结束”不会静默失效。
    killer.on('error', () => forceKill(child));
    killer.on('close', (code) => {
      if (code !== 0) {
        forceKill(child);
      }
    });
    return;
  }

  forceKill(child);
}

/**
 * 真实渲染进程运行器：参数数组启动，不经过 shell。
 *
 * stdin 保持管道（不加 -nostdin），取消时才能写 q 请求优雅退出。
 * 只保留 stderr 尾部用于本次会话诊断，不把原始 stderr 返回渲染进程。
 */
export const runExportProcess: ExportProcessRunner = (request) => {
  let stderrTail = '';
  let settled = false;
  let resolveExited: (result: ExportProcessResult) => void = () => undefined;
  const exited = new Promise<ExportProcessResult>((resolve) => {
    resolveExited = resolve;
  });

  const finish = (result: ExportProcessResult): void => {
    if (settled) {
      return;
    }

    settled = true;
    resolveExited(result);
  };

  let child: ChildProcess;

  try {
    child = spawn(request.command, request.args, {
      cwd: request.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    finish({ exitCode: null, spawnError: (error as Error).message, stderrTail: '' });

    return {
      exited,
      killTree: () => undefined,
      pid: undefined,
      requestQuit: () => undefined,
    };
  }

  // ffmpeg 退出后写 stdin 会触发 EPIPE；这是正常竞态，不能变成未捕获异常。
  child.stdin?.on('error', () => undefined);

  child.stdout?.on('data', (chunk: Buffer) => {
    request.onStdoutChunk?.(chunk.toString('utf8'));
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stderrTail = (stderrTail + text).slice(-MAX_STDERR_TAIL_BYTES);
    request.onStderrChunk?.(text);
  });

  child.on('error', (error: Error) => {
    finish({ exitCode: null, spawnError: error.message, stderrTail });
  });

  child.on('close', (code) => {
    finish({ exitCode: code, stderrTail });
  });

  return {
    exited,
    killTree: () => {
      killProcessTree(child);
    },
    pid: child.pid,
    requestQuit: () => {
      try {
        child.stdin?.write('q\n');
      } catch {
        // stdin 已关闭说明进程已经退出，取消流程会等到 exit 事件后收尾。
      }
    },
  };
};
