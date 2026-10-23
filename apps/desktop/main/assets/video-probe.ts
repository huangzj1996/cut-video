import { spawn } from 'node:child_process';

export interface VideoMetadata {
  durationMs: number;
  fps: number;
  height: number;
  width: number;
}

const PROBE_TIMEOUT_MS = 15_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseRate(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return undefined;
  }

  return numerator / denominator;
}

function parseRotation(stream: Record<string, unknown>): number {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];

  for (const entry of sideData) {
    if (!isRecord(entry)) {
      continue;
    }

    const rotation = toNumber(entry.rotation);

    if (rotation !== undefined) {
      return rotation;
    }
  }

  const tags = isRecord(stream.tags) ? stream.tags : undefined;
  return (tags ? toNumber(tags.rotate) : undefined) ?? 0;
}

/**
 * 解析 ffprobe 的 JSON 输出，返回时间线需要的显示尺寸、帧率和时长。
 * 旋转 90/270 时交换宽高，返回的是「显示尺寸」。
 */
export function parseFfprobeOutput(output: string): VideoMetadata | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStream = streams.find((stream) => {
    if (!isRecord(stream) || stream.codec_type !== 'video') {
      return false;
    }

    const disposition = isRecord(stream.disposition) ? stream.disposition : undefined;
    return disposition?.attached_pic !== 1;
  });

  if (!isRecord(videoStream)) {
    return null;
  }

  const width = toNumber(videoStream.width);
  const height = toNumber(videoStream.height);
  const fps = parseRate(videoStream.avg_frame_rate) ?? parseRate(videoStream.r_frame_rate);
  const format = isRecord(parsed.format) ? parsed.format : undefined;
  const durationSeconds = toNumber(format?.duration) ?? toNumber(videoStream.duration);
  const frameCount = toNumber(videoStream.nb_frames);
  const effectiveDuration =
    durationSeconds ??
    (frameCount !== undefined && fps !== undefined ? frameCount / fps : undefined);

  if (
    width === undefined ||
    height === undefined ||
    fps === undefined ||
    effectiveDuration === undefined ||
    width <= 0 ||
    height <= 0 ||
    fps <= 0 ||
    effectiveDuration <= 0
  ) {
    return null;
  }

  const rotation = parseRotation(videoStream);
  const swapDimensions = Math.abs(Math.round(rotation)) % 180 === 90;

  return {
    durationMs: Math.round(effectiveDuration * 1000),
    fps,
    height: swapDimensions ? width : height,
    width: swapDimensions ? height : width,
  };
}

/**
 * 调用 ffprobe 读取视频元数据。失败、超时或 ffprobe 不可用时返回 null，
 * 不把 stderr 或路径抛给渲染进程。
 */
export async function probeVideo(
  ffprobePath: string,
  filePath: string,
): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    const timerRef: { current?: ReturnType<typeof setTimeout> } = {};

    const finish = (value: VideoMetadata | null): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }

      resolve(value);
    };

    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(
        ffprobePath,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        },
      );
    } catch {
      resolve(null);
      return;
    }

    timerRef.current = setTimeout(() => {
      child.kill();
      finish(null);
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length >= MAX_STDOUT_BYTES) {
        child.kill();
        finish(null);
        return;
      }

      stdout += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      finish(code === 0 ? parseFfprobeOutput(stdout) : null);
    });
  });
}
