import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyMediaFailure,
  MediaError,
  runMediaProcess,
  toMediaErrorSummary,
  type ClassifyMediaFailureInput,
} from './media-error';

function spawnErrorWithCode(code: string): NodeJS.ErrnoException {
  return { code } as NodeJS.ErrnoException;
}

function classify(input: Partial<ClassifyMediaFailureInput>): MediaError {
  return classifyMediaFailure({ operation: 'probe', ...input });
}

async function captureMediaError(promise: Promise<unknown>): Promise<MediaError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MediaError);
    return error as MediaError;
  }

  throw new Error('预期 Promise 被拒绝，但它成功了。');
}

describe('classifyMediaFailure', () => {
  it('classifies timeouts before any other signal', () => {
    const error = classify({
      exitCode: 1,
      stderr: 'Permission denied',
      timedOut: true,
    });

    expect(error.code).toBe('MEDIA_TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('媒体处理超时。');
    expect(error.details).toEqual({ timedOut: true });
  });

  it('classifies a missing binary from ENOENT', () => {
    const error = classify({ spawnError: spawnErrorWithCode('ENOENT') });

    expect(error.code).toBe('MEDIA_BINARY_MISSING');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('未找到 FFmpeg/ffprobe 可执行文件。');
  });

  it('classifies spawn permission errors from EACCES and EPERM', () => {
    for (const code of ['EACCES', 'EPERM']) {
      const error = classify({ spawnError: spawnErrorWithCode(code) });

      expect(error.code).toBe('MEDIA_PERMISSION_DENIED');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('没有权限访问媒体文件或输出目录。');
    }
  });

  it('classifies permission failures from stderr', () => {
    for (const stderr of [
      'clip.mp4: Permission denied',
      'Access is denied.',
      'Operation not permitted',
    ]) {
      const error = classify({ stderr, exitCode: 1 });

      expect(error.code).toBe('MEDIA_PERMISSION_DENIED');
      expect(error.retryable).toBe(false);
    }
  });

  it('classifies output failures from stderr', () => {
    for (const stderr of [
      'Error opening output /tmp/frames/out.jpg: Invalid argument',
      'Could not open file /tmp/frames/out.jpg for writing',
      'No space left on device',
      'Read-only file system',
    ]) {
      const error = classify({ stderr, exitCode: 1 });

      expect(error.code).toBe('MEDIA_OUTPUT_FAILED');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('无法写入关键帧文件。');
    }
  });

  it('does not treat an ambiguous "could not open file" as an output failure', () => {
    const error = classify({ stderr: 'Could not open file /tmp/unknown.bin', exitCode: 1 });

    expect(error.code).toBe('MEDIA_PROCESS_FAILED');
  });

  it('classifies missing inputs from stderr', () => {
    for (const stderr of [
      'clip.mp4: No such file or directory',
      'Could not open input /tmp/clip.mp4',
      'Error opening input file /tmp/clip.mp4',
    ]) {
      const error = classify({ stderr, exitCode: 1 });

      expect(error.code).toBe('MEDIA_INPUT_NOT_FOUND');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('媒体文件不存在或已被移动。');
    }
  });

  it('classifies unsupported formats and codecs from stderr', () => {
    for (const stderr of [
      "Unknown input format: 'xyz'",
      'Unsupported codec with id 999',
      'Codec not supported',
      'Unknown decoder: av1',
      'Decoder (codec av1) not found for input stream #0:0',
      "Unknown encoder 'xyz'",
      "No such filter: 'missing'",
    ]) {
      const error = classify({ stderr, exitCode: 1 });

      expect(error.code).toBe('MEDIA_UNSUPPORTED_FORMAT');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('不支持该媒体格式或编码。');
    }
  });

  it('classifies corrupted media from stderr', () => {
    for (const stderr of [
      'moov atom not found',
      'Invalid data found when processing input',
      'Could not find codec parameters for stream 0',
      'Error while decoding stream #0:0',
      'decode_slice_header error',
      'missing picture in access unit',
      'packet corrupt',
      'partial file',
    ]) {
      const error = classify({ stderr, exitCode: 1 });

      expect(error.code).toBe('MEDIA_CORRUPTED');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('媒体文件已损坏或无法解码。');
    }
  });

  it('falls back to MEDIA_PROCESS_FAILED for unknown failures', () => {
    const error = classify({ stderr: 'something unexpected happened', exitCode: 7 });

    expect(error.code).toBe('MEDIA_PROCESS_FAILED');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('媒体处理失败。');
    expect(error.details).toEqual({ exitCode: 7 });
  });

  it('does not leak stderr or file paths in user-facing messages', () => {
    const sensitiveStderr = 'open /home/secret/clip.mp4 failed: No such file or directory';
    const error = classify({ stderr: sensitiveStderr, exitCode: 1 });

    expect(error.message).toBe('媒体文件不存在或已被移动。');
    expect(error.message).not.toContain('/home/secret');
    expect(error.message).not.toContain('No such file or directory');
    expect(JSON.stringify(error.details ?? {})).not.toContain('/home/secret');
  });
});

describe('toMediaErrorSummary', () => {
  it('keeps code, safe message, and retryable from MediaError', () => {
    const summary = toMediaErrorSummary(
      new MediaError('MEDIA_CORRUPTED', '媒体文件已损坏或无法解码。', false, { exitCode: 3 }),
    );

    expect(summary).toEqual({
      code: 'MEDIA_CORRUPTED',
      message: '媒体文件已损坏或无法解码。',
      retryable: false,
    });
    expect('details' in summary).toBe(false);
  });

  it('maps ordinary errors to a safe MEDIA_PROCESS_FAILED summary', () => {
    const summary = toMediaErrorSummary(new Error('ffprobe failed on /home/secret/clip.mp4'));

    expect(summary).toEqual({
      code: 'MEDIA_PROCESS_FAILED',
      message: '媒体处理失败。',
      retryable: true,
    });
    expect(summary.message).not.toContain('/home/secret');
  });

  it('maps non-Error values to a safe MEDIA_PROCESS_FAILED summary', () => {
    for (const value of [null, undefined, 'boom', { code: 'MEDIA_TIMEOUT' }, 42]) {
      expect(toMediaErrorSummary(value)).toEqual({
        code: 'MEDIA_PROCESS_FAILED',
        message: '媒体处理失败。',
        retryable: true,
      });
    }
  });
});

describe('runMediaProcess', () => {
  it('resolves stdout, stderr, and exit code for a successful process', async () => {
    const result = await runMediaProcess({
      args: ['-e', "process.stdout.write('ok')"],
      binaryPath: process.execPath,
      operation: 'probe',
      timeoutMs: 5_000,
    });

    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: 'ok' });
  });

  it('rejects with MEDIA_PERMISSION_DENIED when stderr reports a permission failure', async () => {
    const error = await captureMediaError(
      runMediaProcess({
        args: ['-e', "process.stderr.write('Permission denied'); process.exit(1)"],
        binaryPath: process.execPath,
        operation: 'extract',
        timeoutMs: 5_000,
      }),
    );

    expect(error.code).toBe('MEDIA_PERMISSION_DENIED');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('没有权限访问媒体文件或输出目录。');
  });

  it('rejects with MEDIA_TIMEOUT when the process runs too long', async () => {
    const error = await captureMediaError(
      runMediaProcess({
        args: ['-e', 'setTimeout(() => {}, 5000)'],
        binaryPath: process.execPath,
        operation: 'probe',
        timeoutMs: 100,
      }),
    );

    expect(error.code).toBe('MEDIA_TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('媒体处理超时。');
  });

  it('rejects with MEDIA_BINARY_MISSING for a non-existent binary', async () => {
    const missingBinary = path.join(tmpdir(), `miaoma-missing-${randomUUID()}.exe`);

    const error = await captureMediaError(
      runMediaProcess({
        args: [],
        binaryPath: missingBinary,
        operation: 'probe',
        timeoutMs: 5_000,
      }),
    );

    expect(error.code).toBe('MEDIA_BINARY_MISSING');
    expect(error.retryable).toBe(false);
  });

  it('rejects when stdout exceeds maxStdoutBytes', async () => {
    const error = await captureMediaError(
      runMediaProcess({
        args: ['-e', "process.stdout.write('x'.repeat(4096))"],
        binaryPath: process.execPath,
        maxStdoutBytes: 64,
        operation: 'probe',
        timeoutMs: 5_000,
      }),
    );

    expect(error.code).toBe('MEDIA_PROCESS_FAILED');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('媒体处理输出超出限制。');
  });

  it('rejects with MEDIA_PROCESS_FAILED and keeps the exit code for unknown failures', async () => {
    const error = await captureMediaError(
      runMediaProcess({
        args: ['-e', 'process.exit(3)'],
        binaryPath: process.execPath,
        operation: 'extract',
        timeoutMs: 5_000,
      }),
    );

    expect(error.code).toBe('MEDIA_PROCESS_FAILED');
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ exitCode: 3 });
  });
});
