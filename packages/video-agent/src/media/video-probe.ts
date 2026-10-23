import { MediaError, runMediaProcess } from './media-error';

export interface VideoAudioMetadata {
  bitRate?: number;
  channelLayout?: string;
  channels?: number;
  codec?: string;
  sampleRate?: number;
}

export interface VideoMetadata {
  audio?: VideoAudioMetadata;
  bitRate?: number;
  codec?: string;
  codecLongName?: string;
  codedHeight?: number;
  codedWidth?: number;
  colorPrimaries?: string;
  colorSpace?: string;
  colorTransfer?: string;
  container?: string;
  displayAspectRatio?: string;
  durationMs: number;
  formatLongName?: string;
  fps: number;
  frameCount?: number;
  height: number;
  isHdr: boolean;
  isVfr: boolean;
  pixelFormat?: string;
  profile?: string;
  rotation: number;
  sampleAspectRatio?: string;
  sizeBytes?: number;
  width: number;
}

export type VideoProbeResult =
  { ok: true; metadata: VideoMetadata } | { ok: false; error: MediaError };

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

function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const text = value.trim();
  return text.length > 0 ? text : undefined;
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

function normalizeRotation(value: number): number {
  const normalized = Math.round(value) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function parseAudioMetadata(stream: Record<string, unknown>): VideoAudioMetadata {
  return {
    bitRate: toNumber(stream.bit_rate),
    channelLayout: toText(stream.channel_layout),
    channels: toNumber(stream.channels),
    codec: toText(stream.codec_name),
    sampleRate: toNumber(stream.sample_rate),
  };
}

/**
 * 解析 ffprobe 的 JSON 输出，返回完整的视频元数据：
 * 时长、显示/编码分辨率、帧率、VFR、编码、profile、像素格式、旋转角、
 * 色彩信息、HDR 标记、码率、容器，以及首条音频流信息。
 *
 * 旋转 90/270 时 `width/height` 返回显示尺寸，`codedWidth/codedHeight`
 * 保留编码尺寸；`rotation` 归一化到 0–359。
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

  const format = isRecord(parsed.format) ? parsed.format : {};
  const codedWidth = toNumber(videoStream.width);
  const codedHeight = toNumber(videoStream.height);
  const averageFps = parseRate(videoStream.avg_frame_rate);
  const realFps = parseRate(videoStream.r_frame_rate);
  const fps = averageFps ?? realFps;
  const frameCount = toNumber(videoStream.nb_frames);
  const durationSeconds =
    toNumber(format.duration) ??
    toNumber(videoStream.duration) ??
    (frameCount !== undefined && fps !== undefined ? frameCount / fps : undefined);

  if (
    codedWidth === undefined ||
    codedHeight === undefined ||
    fps === undefined ||
    durationSeconds === undefined ||
    codedWidth <= 0 ||
    codedHeight <= 0 ||
    fps <= 0 ||
    durationSeconds <= 0
  ) {
    return null;
  }

  const rotation = normalizeRotation(parseRotation(videoStream));
  const swapDimensions = rotation === 90 || rotation === 270;
  const colorTransfer = toText(videoStream.color_transfer);
  const colorPrimaries = toText(videoStream.color_primaries);
  const isHdr =
    colorTransfer === 'smpte2084' ||
    colorTransfer === 'arib-std-b67' ||
    colorPrimaries === 'bt2020';
  const isVfr =
    averageFps !== undefined &&
    realFps !== undefined &&
    Math.abs(averageFps - realFps) > Math.max(averageFps, realFps) * 0.01;
  const audioStream = streams.find((stream) => isRecord(stream) && stream.codec_type === 'audio');

  return {
    audio: isRecord(audioStream) ? parseAudioMetadata(audioStream) : undefined,
    bitRate: toNumber(format.bit_rate) ?? toNumber(videoStream.bit_rate),
    codec: toText(videoStream.codec_name),
    codecLongName: toText(videoStream.codec_long_name),
    codedHeight,
    codedWidth,
    colorPrimaries,
    colorSpace: toText(videoStream.color_space),
    colorTransfer,
    container: toText(format.format_name),
    displayAspectRatio: toText(videoStream.display_aspect_ratio),
    durationMs: Math.round(durationSeconds * 1000),
    formatLongName: toText(format.format_long_name),
    fps,
    frameCount,
    height: swapDimensions ? codedWidth : codedHeight,
    isHdr,
    isVfr,
    pixelFormat: toText(videoStream.pix_fmt),
    profile: toText(videoStream.profile),
    rotation,
    sampleAspectRatio: toText(videoStream.sample_aspect_ratio),
    sizeBytes: toNumber(format.size),
    width: swapDimensions ? codedHeight : codedWidth,
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
  const result = await probeVideoResult(ffprobePath, filePath);
  return result.ok ? result.metadata : null;
}

/**
 * 调用 ffprobe 探测视频并返回结构化结果。
 * 任何失败都转换为 `{ ok: false, error }`，不会抛出异常；
 * error.message 为安全中文文案，不包含路径或原始 stderr。
 */
export async function probeVideoResult(
  ffprobePath: string,
  filePath: string,
): Promise<VideoProbeResult> {
  try {
    const { stdout } = await runMediaProcess({
      args: ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      binaryPath: ffprobePath,
      maxStdoutBytes: MAX_STDOUT_BYTES,
      operation: 'probe',
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const metadata = parseFfprobeOutput(stdout);

    if (!metadata) {
      return {
        error: new MediaError(
          'MEDIA_UNSUPPORTED_FORMAT',
          '无法解析视频信息，文件可能已损坏或格式不受支持。',
        ),
        ok: false,
      };
    }

    return { metadata, ok: true };
  } catch (error) {
    if (error instanceof MediaError) {
      return { error, ok: false };
    }

    return { error: new MediaError('MEDIA_PROCESS_FAILED', '媒体处理失败。', true), ok: false };
  }
}
