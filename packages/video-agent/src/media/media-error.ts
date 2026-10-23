import { spawn, type ChildProcess } from 'node:child_process';

export type MediaErrorCode =
  | 'MEDIA_BINARY_MISSING'
  | 'MEDIA_PERMISSION_DENIED'
  | 'MEDIA_INPUT_NOT_FOUND'
  | 'MEDIA_UNSUPPORTED_FORMAT'
  | 'MEDIA_CORRUPTED'
  | 'MEDIA_TIMEOUT'
  | 'MEDIA_PROCESS_FAILED'
  | 'MEDIA_OUTPUT_FAILED';

export type MediaOperation = 'probe' | 'extract';

export interface MediaErrorSummary {
  code: MediaErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * 媒体处理错误。
 *
 * `message` 固定为面向用户的安全中文文案，不携带文件路径、原始 stderr 或堆栈；
 * `details` 只放退出码、超时标记等非敏感结构化信息。
 */
export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: MediaErrorCode,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 256 * 1024;

const PERMISSION_DENIED_PATTERN = /permission denied|access is denied|operation not permitted/i;
const INPUT_NOT_FOUND_PATTERN =
  /no such file or directory|could not open input|error opening input/i;
const UNSUPPORTED_FORMAT_PATTERN =
  /unknown input format|unsupported|not supported|unknown decoder|decoder .* not found|unknown encoder|no such filter/i;
const CORRUPTED_PATTERN =
  /invalid data found|moov atom not found|could not find codec parameters|error while decoding|decode_slice_header error|missing picture|packet corrupt|partial file|corrupt/i;

/**
 * `could not open file` 既可能指向输入也可能指向输出，
 * 只有同时出现 writing 时才判定为输出写入失败。
 */
function isOutputFailure(stderr: string): boolean {
  return (
    /error opening output/i.test(stderr) ||
    (/could not open file/i.test(stderr) && /writing/i.test(stderr)) ||
    /no space left on device/i.test(stderr) ||
    /read-only file system/i.test(stderr)
  );
}

/** 把任意异常转成可安全放进 IPC/清单的摘要；未知异常归为 MEDIA_PROCESS_FAILED。 */
export function toMediaErrorSummary(error: unknown): MediaErrorSummary {
  if (error instanceof MediaError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: 'MEDIA_PROCESS_FAILED',
    message: '媒体处理失败。',
    retryable: true,
  };
}

export interface ClassifyMediaFailureInput {
  operation: MediaOperation;
  spawnError?: NodeJS.ErrnoException;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

/**
 * 解析失败原因并返回带中文安全消息的 MediaError。
 * 不携带原始 stderr 或文件路径；判定顺序与 ffmpeg 错误文案的常见优先级一致。
 */
export function classifyMediaFailure(input: ClassifyMediaFailureInput): MediaError {
  const stderr = input.stderr ?? '';

  if (input.timedOut) {
    return new MediaError('MEDIA_TIMEOUT', '媒体处理超时。', true, { timedOut: true });
  }

  const spawnErrorCode = input.spawnError?.code;

  if (spawnErrorCode === 'ENOENT') {
    return new MediaError('MEDIA_BINARY_MISSING', '未找到 FFmpeg/ffprobe 可执行文件。');
  }

  if (spawnErrorCode === 'EACCES' || spawnErrorCode === 'EPERM') {
    return new MediaError('MEDIA_PERMISSION_DENIED', '没有权限访问媒体文件或输出目录。');
  }

  if (PERMISSION_DENIED_PATTERN.test(stderr)) {
    return new MediaError('MEDIA_PERMISSION_DENIED', '没有权限访问媒体文件或输出目录。');
  }

  if (isOutputFailure(stderr)) {
    return new MediaError('MEDIA_OUTPUT_FAILED', '无法写入关键帧文件。', true);
  }

  if (INPUT_NOT_FOUND_PATTERN.test(stderr)) {
    return new MediaError('MEDIA_INPUT_NOT_FOUND', '媒体文件不存在或已被移动。');
  }

  if (UNSUPPORTED_FORMAT_PATTERN.test(stderr)) {
    return new MediaError('MEDIA_UNSUPPORTED_FORMAT', '不支持该媒体格式或编码。');
  }

  if (CORRUPTED_PATTERN.test(stderr)) {
    return new MediaError('MEDIA_CORRUPTED', '媒体文件已损坏或无法解码。');
  }

  return new MediaError(
    'MEDIA_PROCESS_FAILED',
    '媒体处理失败。',
    true,
    typeof input.exitCode === 'number' ? { exitCode: input.exitCode } : undefined,
  );
}

export interface RunMediaProcessOptions {
  binaryPath: string;
  args: string[];
  operation: MediaOperation;
  timeoutMs: number;
  /** 默认 1 MiB */
  maxStdoutBytes?: number;
  /** 默认 256 KiB */
  maxStderrBytes?: number;
}

export interface MediaProcessResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * 启动媒体子进程；spawn 失败、超时、非 0 退出、输出超限都会 reject MediaError。
 * 参数始终以数组传递，不经过 shell。
 */
export function runMediaProcess(options: RunMediaProcessOptions): Promise<MediaProcessResult> {
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;

  return new Promise<MediaProcessResult>((resolve, reject) => {
    let settled = false;
    const timerRef: { current?: ReturnType<typeof setTimeout> } = {};
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }

      action();
    };

    const fail = (error: MediaError): void => {
      settle(() => reject(error));
    };

    let child: ChildProcess;

    try {
      child = spawn(options.binaryPath, options.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      fail(
        classifyMediaFailure({
          operation: options.operation,
          spawnError: error as NodeJS.ErrnoException,
        }),
      );
      return;
    }

    timerRef.current = setTimeout(() => {
      child.kill();
      fail(classifyMediaFailure({ operation: options.operation, timedOut: true }));
    }, options.timeoutMs);

    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      if (settled) {
        return;
      }

      if (stream === 'stdout') {
        stdoutBytes += chunk.length;

        if (stdoutBytes > maxStdoutBytes) {
          child.kill();
          fail(new MediaError('MEDIA_PROCESS_FAILED', '媒体处理输出超出限制。', true));
          return;
        }

        stdoutChunks.push(chunk);
        return;
      }

      stderrBytes += chunk.length;

      if (stderrBytes > maxStderrBytes) {
        child.kill();
        fail(new MediaError('MEDIA_PROCESS_FAILED', '媒体处理输出超出限制。', true));
        return;
      }

      stderrChunks.push(chunk);
    };

    child.stdout?.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));

    child.on('error', (error: Error) => {
      fail(
        classifyMediaFailure({
          operation: options.operation,
          spawnError: error as NodeJS.ErrnoException,
        }),
      );
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) {
        settle(() => resolve({ exitCode: 0, stderr, stdout }));
        return;
      }

      fail(classifyMediaFailure({ operation: options.operation, stderr, exitCode: code }));
    });
  });
}
