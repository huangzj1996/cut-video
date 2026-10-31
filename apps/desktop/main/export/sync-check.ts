import type { ExportSyncSummary } from '../../shared/ipc-contract';

/**
 * 导出后同步自检（结构性）：只对成片的客观事实做判定，不看内容语义，也不做口型检查。
 *
 * 判据（容差 = 一个输出帧）：
 * - 视频流与音频流都存在；
 * - 两路起点都为 0（AAC 编码填充允许落在容差内），且两路起点互相对齐；
 * - 两路时长与时间线期望的偏差都不超过容差；
 * - 编码、分辨率、帧率符合渲染配置。
 *
 * 读不到的字段一律 fail closed：自检无法核对的成品不允许提交。
 * 这些是纯函数：输入 ffprobe 的 JSON 输出与计划编译器给出的期望规格，不读磁盘、不启动进程。
 */

/** 允许的偏差：一个输出帧。 */
export const SYNC_TOLERANCE_FRAMES = 1;

/** 浮点比较余量：秒转毫秒会引入二进制小数误差，不该把“正好一帧”判失败。 */
const EPSILON_MS = 1e-6;

/** 渲染配置里与同步自检相关的期望值；导出计划编译器的 expected 直接满足它。 */
export interface ExportSyncExpectation {
  audioCodec: string;
  durationMs: number;
  fps: number;
  height: number;
  videoCodec: string;
  width: number;
}

/** 我们从 ffprobe 里读到的单路流事实；读不到的字段是 null，不猜。 */
export interface ExportSyncStream {
  codec: string | null;
  durationMs: number | null;
  fps: number | null;
  height: number | null;
  startMs: number | null;
  width: number | null;
}

export interface ExportSyncProbe {
  audio: ExportSyncStream | null;
  /** 容器时长；流级时长缺失时作为兜底。 */
  durationMs: number | null;
  video: ExportSyncStream | null;
}

export interface ExportSyncMeasurements {
  audioDurationMs: number | null;
  audioStartMs: number | null;
  /** 两路时长与时间线期望的最大偏差；任一路读不到时为 null。 */
  durationDeltaMs: number | null;
  /** 音视频起点差（绝对值）；任一路读不到时为 null。 */
  startDeltaMs: number | null;
  videoDurationMs: number | null;
  videoStartMs: number | null;
}

export type ExportSyncIssueCode =
  | 'MISSING_VIDEO_STREAM'
  | 'MISSING_AUDIO_STREAM'
  | 'MISSING_START_TIME'
  | 'VIDEO_START_OFFSET'
  | 'AUDIO_START_OFFSET'
  | 'STREAM_START_MISMATCH'
  | 'MISSING_DURATION'
  | 'VIDEO_DURATION_MISMATCH'
  | 'AUDIO_DURATION_MISMATCH'
  | 'VIDEO_CODEC_MISMATCH'
  | 'AUDIO_CODEC_MISMATCH'
  | 'MISSING_RESOLUTION'
  | 'RESOLUTION_MISMATCH'
  | 'MISSING_FRAME_RATE'
  | 'FRAME_RATE_MISMATCH'
  | 'METADATA_UNPARSABLE';

/** 单条自检问题：code 供程序判断，detail 是技术描述，只进“查看失败详情”。 */
export interface ExportSyncIssue {
  code: ExportSyncIssueCode;
  detail: string;
}

export interface ExportSyncReport {
  issues: ExportSyncIssue[];
  measurements: ExportSyncMeasurements;
  passed: boolean;
  /** 成功态要展示的客观数字；由 measurements 派生，避免调用方各自拼装。 */
  summary: ExportSyncSummary;
  /** 一个输出帧对应的容差毫秒数。 */
  toleranceMs: number;
}

interface FfprobeStreamJson {
  attached_pic?: boolean | number;
  avg_frame_rate?: unknown;
  codec_name?: unknown;
  codec_type?: unknown;
  disposition?: { attached_pic?: unknown } | null;
  duration?: unknown;
  height?: unknown;
  r_frame_rate?: unknown;
  start_time?: unknown;
  width?: unknown;
}

interface FfprobeJson {
  format?: { duration?: unknown } | null;
  streams?: unknown;
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function secondsToMs(value: unknown): number | null {
  const seconds = readFiniteNumber(value);

  return seconds === null ? null : seconds * 1_000;
}

/** 解析形如 "30/1" 的帧率；0/0 与缺失都当作读不到。 */
function parseFrameRate(value: unknown): number | null {
  if (typeof value === 'number') {
    return value > 0 ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const [numerator, denominator] = value.split('/');
  const top = readFiniteNumber(numerator);
  const bottom = denominator === undefined ? 1 : readFiniteNumber(denominator);

  if (top === null || bottom === null || top <= 0 || bottom <= 0) {
    return null;
  }

  return top / bottom;
}

function isAttachedPicture(stream: FfprobeStreamJson): boolean {
  return stream.disposition?.attached_pic === 1 || stream.attached_pic === 1;
}

function toStream(stream: FfprobeStreamJson, type: 'audio' | 'video'): ExportSyncStream {
  const isVideo = type === 'video';

  return {
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : null,
    durationMs: secondsToMs(stream.duration),
    fps: isVideo
      ? (parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate))
      : null,
    height: isVideo ? readFiniteNumber(stream.height) : null,
    startMs: secondsToMs(stream.start_time),
    width: isVideo ? readFiniteNumber(stream.width) : null,
  };
}

function firstStream(
  streams: readonly FfprobeStreamJson[],
  type: 'audio' | 'video',
): FfprobeStreamJson | null {
  for (const stream of streams) {
    if (stream.codec_type === type && !(type === 'video' && isAttachedPicture(stream))) {
      return stream;
    }
  }

  return null;
}

/**
 * 把 ffprobe 的 `-show_streams -show_format -of json` 输出解析成自检需要的事实。
 * 输出不是 ffprobe JSON 的形状（没有 streams 数组）时返回 null，由判定层报 METADATA_UNPARSABLE。
 */
export function parseFfprobeJson(text: string): ExportSyncProbe | null {
  let parsed: FfprobeJson;

  try {
    parsed = JSON.parse(text) as FfprobeJson;
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.streams)) {
    return null;
  }

  const streams = parsed.streams.filter(
    (stream): stream is FfprobeStreamJson => stream !== null && typeof stream === 'object',
  );
  const video = firstStream(streams, 'video');
  const audio = firstStream(streams, 'audio');

  return {
    audio: audio ? toStream(audio, 'audio') : null,
    durationMs: secondsToMs(parsed.format?.duration),
    video: video ? toStream(video, 'video') : null,
  };
}

/** ffprobe 查询成片事实的命令参数；进程由调用方用注入的运行器启动。 */
export function buildFfprobeArgs(filePath: string): string[] {
  return ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath];
}

/** 一个输出帧对应的容差毫秒数；期望帧率异常时容差取 0（宁可判失败，不放行无法核对的成品）。 */
export function syncToleranceMs(fps: number): number {
  return fps > 0 ? (1_000 / fps) * SYNC_TOLERANCE_FRAMES : 0;
}

function withinTolerance(deltaMs: number, toleranceMs: number): boolean {
  return deltaMs <= toleranceMs + EPSILON_MS;
}

function formatMs(value: number | null): string {
  return value === null ? 'unknown' : value.toFixed(3) + 'ms';
}

function codecMatches(actual: string | null, expected: string): boolean {
  return actual !== null && actual.toLowerCase() === expected.toLowerCase();
}

function emptyMeasurements(): ExportSyncMeasurements {
  return {
    audioDurationMs: null,
    audioStartMs: null,
    durationDeltaMs: null,
    startDeltaMs: null,
    videoDurationMs: null,
    videoStartMs: null,
  };
}

/**
 * 量出两路起点与时长偏差。流级时长缺失时退回容器时长——
 * 容器没写流时长不该被误判成“时长不符”。
 */
function measureSync(
  probe: ExportSyncProbe,
  expected: ExportSyncExpectation,
): ExportSyncMeasurements {
  const videoDurationMs = probe.video?.durationMs ?? probe.durationMs;
  const audioDurationMs = probe.audio?.durationMs ?? probe.durationMs;
  const videoStartMs = probe.video?.startMs ?? null;
  const audioStartMs = probe.audio?.startMs ?? null;

  return {
    audioDurationMs,
    audioStartMs,
    durationDeltaMs:
      videoDurationMs === null || audioDurationMs === null
        ? null
        : Math.max(
            Math.abs(videoDurationMs - expected.durationMs),
            Math.abs(audioDurationMs - expected.durationMs),
          ),
    startDeltaMs:
      videoStartMs === null || audioStartMs === null ? null : Math.abs(audioStartMs - videoStartMs),
    videoDurationMs,
    videoStartMs,
  };
}

function checkStreamPresence(probe: ExportSyncProbe, issues: ExportSyncIssue[]): void {
  if (!probe.video) {
    issues.push({ code: 'MISSING_VIDEO_STREAM', detail: 'no video stream in the exported file' });
  }

  if (!probe.audio) {
    issues.push({ code: 'MISSING_AUDIO_STREAM', detail: 'no audio stream in the exported file' });
  }
}

function checkStarts(
  measurements: ExportSyncMeasurements,
  toleranceMs: number,
  issues: ExportSyncIssue[],
): void {
  const streams = [
    { code: 'VIDEO_START_OFFSET' as const, label: 'video', startMs: measurements.videoStartMs },
    { code: 'AUDIO_START_OFFSET' as const, label: 'audio', startMs: measurements.audioStartMs },
  ];

  for (const stream of streams) {
    if (stream.startMs === null) {
      issues.push({
        code: 'MISSING_START_TIME',
        detail: stream.label + ' start time is unreadable',
      });
      continue;
    }

    if (!withinTolerance(Math.abs(stream.startMs), toleranceMs)) {
      issues.push({
        code: stream.code,
        detail:
          stream.label +
          ' starts at ' +
          formatMs(stream.startMs) +
          ', tolerance ' +
          formatMs(toleranceMs),
      });
    }
  }

  const { startDeltaMs } = measurements;

  if (startDeltaMs !== null && !withinTolerance(startDeltaMs, toleranceMs)) {
    issues.push({
      code: 'STREAM_START_MISMATCH',
      detail: 'audio/video start delta ' + formatMs(startDeltaMs),
    });
  }
}

function checkDurations(
  measurements: ExportSyncMeasurements,
  expected: ExportSyncExpectation,
  toleranceMs: number,
  issues: ExportSyncIssue[],
): void {
  const streams = [
    {
      actualMs: measurements.videoDurationMs,
      code: 'VIDEO_DURATION_MISMATCH' as const,
      label: 'video',
    },
    {
      actualMs: measurements.audioDurationMs,
      code: 'AUDIO_DURATION_MISMATCH' as const,
      label: 'audio',
    },
  ];

  for (const stream of streams) {
    if (stream.actualMs === null) {
      issues.push({ code: 'MISSING_DURATION', detail: stream.label + ' duration is unreadable' });
      continue;
    }

    const deltaMs = Math.abs(stream.actualMs - expected.durationMs);

    if (!withinTolerance(deltaMs, toleranceMs)) {
      issues.push({
        code: stream.code,
        detail:
          stream.label +
          ' duration ' +
          formatMs(stream.actualMs) +
          ' vs timeline ' +
          formatMs(expected.durationMs),
      });
    }
  }
}

function checkVideoFormat(
  video: ExportSyncStream,
  expected: ExportSyncExpectation,
  issues: ExportSyncIssue[],
): void {
  if (!codecMatches(video.codec, expected.videoCodec)) {
    issues.push({
      code: 'VIDEO_CODEC_MISMATCH',
      detail: 'video codec ' + String(video.codec) + ', expected ' + expected.videoCodec,
    });
  }

  if (video.width === null || video.height === null) {
    issues.push({ code: 'MISSING_RESOLUTION', detail: 'video resolution is unreadable' });
  } else if (video.width !== expected.width || video.height !== expected.height) {
    issues.push({
      code: 'RESOLUTION_MISMATCH',
      detail:
        'resolution ' +
        video.width +
        'x' +
        video.height +
        ', expected ' +
        expected.width +
        'x' +
        expected.height,
    });
  }

  if (video.fps === null) {
    issues.push({ code: 'MISSING_FRAME_RATE', detail: 'video frame rate is unreadable' });
    return;
  }

  if (Math.abs(video.fps - expected.fps) > 0.01) {
    issues.push({
      code: 'FRAME_RATE_MISMATCH',
      detail: 'frame rate ' + String(video.fps) + ', expected ' + String(expected.fps),
    });
  }
}

function checkOutputFormat(
  probe: ExportSyncProbe,
  expected: ExportSyncExpectation,
  issues: ExportSyncIssue[],
): void {
  if (probe.video) {
    checkVideoFormat(probe.video, expected, issues);
  }

  if (probe.audio && !codecMatches(probe.audio.codec, expected.audioCodec)) {
    issues.push({
      code: 'AUDIO_CODEC_MISMATCH',
      detail: 'audio codec ' + String(probe.audio.codec) + ', expected ' + expected.audioCodec,
    });
  }
}

/**
 * 判定一次导出的成品是否通过同步自检。
 * probe 为 null 表示读不到媒体信息；此时 fail closed，绝不因为“读不到”而放行。
 */
export function evaluateExportSync(
  probe: ExportSyncProbe | null,
  expected: ExportSyncExpectation,
): ExportSyncReport {
  const toleranceMs = syncToleranceMs(expected.fps);

  if (!probe) {
    const measurements = emptyMeasurements();

    return {
      issues: [{ code: 'METADATA_UNPARSABLE', detail: 'ffprobe output is not valid media JSON' }],
      measurements,
      passed: false,
      summary: { durationDeltaMs: null, startDeltaMs: null },
      toleranceMs,
    };
  }

  const issues: ExportSyncIssue[] = [];
  const measurements = measureSync(probe, expected);

  checkStreamPresence(probe, issues);
  checkStarts(measurements, toleranceMs, issues);
  checkDurations(measurements, expected, toleranceMs, issues);
  checkOutputFormat(probe, expected, issues);

  return {
    issues,
    measurements,
    passed: issues.length === 0,
    summary: {
      durationDeltaMs: measurements.durationDeltaMs,
      startDeltaMs: measurements.startDeltaMs,
    },
    toleranceMs,
  };
}
