import { MediaError, runMediaProcess } from './media-error';

const PROBE_TIMEOUT_MS = 15_000;
const MAX_STDOUT_BYTES = 64 * 1024;

/** 音频探测结果；失败时只返回安全中文文案，不透出原始 stderr。 */
export type AudioProbeResult = { durationMs: number; ok: true } | { message: string; ok: false };

/**
 * 解析 `ffprobe -show_entries format=duration -of json` 的时长（秒）。
 * 同时接受裸数字文本，便于调用方在参数变化时复用。
 */
export function parseFfprobeDurationSeconds(output: string): number | null {
  const text = output.trim();

  if (text.length === 0) {
    return null;
  }

  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) {
    const plain = Number(text);

    return Number.isFinite(plain) && plain > 0 ? plain : null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const format = (parsed as { format?: unknown }).format;

  if (typeof format !== 'object' || format === null) {
    return null;
  }

  const duration = (format as { duration?: unknown }).duration;
  const value =
    typeof duration === 'number'
      ? duration
      : typeof duration === 'string'
        ? Number(duration)
        : Number.NaN;

  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 用 ffprobe 读取音频文件的精确时长。失败返回 `{ ok: false }`，不抛出。
 * 只依赖 format.duration，因此 mp3/wav/m4a 等只含音频流的容器都能读取。
 */
export async function probeAudioDuration(
  ffprobePath: string,
  filePath: string,
): Promise<AudioProbeResult> {
  try {
    const { stdout } = await runMediaProcess({
      args: ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
      binaryPath: ffprobePath,
      maxStdoutBytes: MAX_STDOUT_BYTES,
      operation: 'probe',
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const seconds = parseFfprobeDurationSeconds(stdout);

    if (seconds === null) {
      return {
        message: '无法读取音频时长，文件可能已损坏或格式不受支持。',
        ok: false,
      };
    }

    return { durationMs: Math.round(seconds * 1_000), ok: true };
  } catch (error) {
    return {
      message: error instanceof MediaError ? error.message : '音频探测失败。',
      ok: false,
    };
  }
}
