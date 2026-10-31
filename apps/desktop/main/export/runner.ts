import { spawn } from 'node:child_process';

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

export type ExportProcessRunner = (request: ExportProcessRequest) => Promise<ExportProcessResult>;

/**
 * 真实渲染进程运行器：参数数组启动，不经过 shell。
 * 只保留 stderr 尾部用于本次会话诊断，不把原始 stderr 返回渲染进程。
 */
export const runExportProcess: ExportProcessRunner = (request) => {
  return new Promise<ExportProcessResult>((resolve) => {
    let settled = false;
    let stderrTail = '';

    const finish = (result: ExportProcessResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    let child;

    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      finish({ exitCode: null, spawnError: (error as Error).message, stderrTail: '' });
      return;
    }

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
  });
};
