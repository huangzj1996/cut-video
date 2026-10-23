import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { MediaError, runMediaProcess } from './media-error';

export const MAX_KEYFRAMES_PER_VIDEO = 8;
export const DEFAULT_KEYFRAME_LONG_EDGE = 768;
export const MAX_KEYFRAME_LONG_EDGE = 768;
export const DEFAULT_KEYFRAME_TIMEOUT_MS = 30_000;
export const KEYFRAME_CACHE_VERSION = 1;

const KEYFRAME_INTERVAL_MS = 5000;
const CACHE_MANIFEST_FILE = 'keyframes.json';
const MAX_FRAME_STDOUT_BYTES = 64 * 1024;
const MAX_FRAME_STDERR_BYTES = 256 * 1024;

export interface KeyframeSource {
  path: string;
  durationMs: number;
  /** 显示方向尺寸（已处理旋转）；ffmpeg 默认 autorotate 会输出该方向 */
  width: number;
  height: number;
}

export interface KeyframeOptions {
  /** 关键帧缓存根目录，例如 <project>/cache/keyframes */
  cacheRoot: string;
  /** ffmpeg 可执行文件路径，由调用方通过 resolveMediaBinary 解析 */
  ffmpegPath: string;
  /** 最多帧数，默认/硬上限 8 */
  maxFrames?: number;
  /** 长边像素，默认 768，硬上限 768，不放大原图 */
  longEdge?: number;
  /** 单帧 ffmpeg 超时，默认 30s */
  timeoutMs?: number;
}

export interface ExtractedKeyframe {
  height: number;
  path: string;
  timeMs: number;
  width: number;
}

export interface KeyframeExtractionResult {
  cacheKey: string;
  frames: ExtractedKeyframe[];
  fromCache: boolean;
}

export interface KeyframeExtractorDeps {
  hashFile?: (filePath: string) => Promise<string>;
  runProcess?: typeof runMediaProcess;
}

interface ResolvedKeyframeOptions {
  cacheRoot: string;
  ffmpegPath: string;
  longEdge: number;
  maxFrames: number;
  timeoutMs: number;
}

interface KeyframeCacheManifest {
  version: number;
  cacheKey: string;
  createdAt: string;
  options: { longEdge: number; maxFrames: number };
  source: { width: number; height: number };
  frames: ExtractedKeyframe[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeMaxFrames(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MAX_KEYFRAMES_PER_VIDEO;
  }

  return clamp(Math.floor(value), 1, MAX_KEYFRAMES_PER_VIDEO);
}

function normalizeLongEdge(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_KEYFRAME_LONG_EDGE;
  }

  return clamp(Math.floor(value), 1, MAX_KEYFRAME_LONG_EDGE);
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_KEYFRAME_TIMEOUT_MS;
  }

  return Math.floor(value);
}

/**
 * 按时长动态决定帧数（1..8），返回均匀分布、位于各分段中心的整数毫秒时间点。
 *
 * 期望每 5 秒一帧，再由 maxFrames 限制；时间点严格小于 durationMs，
 * 非法时长返回空数组。
 */
export function planKeyframeTimestamps(
  durationMs: number,
  maxFrames: number = MAX_KEYFRAMES_PER_VIDEO,
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return [];
  }

  const frameLimit = normalizeMaxFrames(maxFrames);
  const desired = Math.max(1, Math.round(durationMs / KEYFRAME_INTERVAL_MS));
  const count = Math.min(desired, frameLimit);
  const seen = new Set<number>();
  const timestamps: number[] = [];

  for (let index = 0; index < count; index += 1) {
    let timeMs = Math.round(((index + 0.5) * durationMs) / count);

    // 轮询到恰好等于视频时长时回退 1ms，保证 seek 落在有效范围内。
    if (timeMs >= durationMs) {
      timeMs = Math.max(0, Math.ceil(durationMs) - 1);
    }

    if (timeMs < 0 || timeMs >= durationMs || seen.has(timeMs)) {
      continue;
    }

    seen.add(timeMs);
    timestamps.push(timeMs);
  }

  return timestamps.sort((left, right) => left - right);
}

/** 计算等比缩放后的目标尺寸，长边不超过 longEdge，且绝不放大。 */
export function computeScaledSize(
  width: number,
  height: number,
  longEdge: number = DEFAULT_KEYFRAME_LONG_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }

  const targetLongEdge = normalizeLongEdge(longEdge);
  const longestEdge = Math.max(width, height);
  const scale = Math.min(1, targetLongEdge / longestEdge);

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function mapReadFailure(error: unknown): MediaError {
  if (error instanceof MediaError) {
    return error;
  }

  const code = getErrorCode(error);

  if (code === 'ENOENT') {
    return new MediaError('MEDIA_INPUT_NOT_FOUND', '找不到视频文件，无法提取关键帧。', false);
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return new MediaError('MEDIA_PERMISSION_DENIED', '没有权限读取视频文件。', false);
  }

  return new MediaError('MEDIA_PROCESS_FAILED', '读取视频文件失败。', true);
}

function mapCacheWriteFailure(error: unknown): MediaError {
  if (error instanceof MediaError) {
    return error;
  }

  const code = getErrorCode(error);

  if (code === 'EACCES' || code === 'EPERM') {
    return new MediaError('MEDIA_PERMISSION_DENIED', '没有权限写入关键帧缓存。', false);
  }

  return new MediaError('MEDIA_OUTPUT_FAILED', '写入关键帧缓存失败。', false);
}

/** 默认按文件内容计算 SHA-256，流式读取以避免大视频占用内存。 */
async function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (error) => reject(mapReadFailure(error)));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function resolveOptions(options: KeyframeOptions): ResolvedKeyframeOptions {
  return {
    cacheRoot: path.resolve(options.cacheRoot),
    ffmpegPath: options.ffmpegPath,
    longEdge: normalizeLongEdge(options.longEdge),
    maxFrames: normalizeMaxFrames(options.maxFrames),
    timeoutMs: normalizeTimeout(options.timeoutMs),
  };
}

function getCacheDirectory(cacheRoot: string, cacheKey: string): string {
  return path.join(cacheRoot, cacheKey.slice(0, 2), cacheKey);
}

function buildFrameFileName(index: number, timeMs: number): string {
  return `frame-${String(index + 1).padStart(2, '0')}-${timeMs}ms.jpg`;
}

function buildFrameArgs(
  sourcePath: string,
  timeMs: number,
  width: number,
  height: number,
  outputPath: string,
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-ss',
    (timeMs / 1000).toFixed(3),
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-an',
    '-sn',
    '-vf',
    `scale=${width}:${height}:flags=lanczos`,
    '-q:v',
    '3',
    '-y',
    outputPath,
  ];
}

function readCachedFrames(
  directory: string,
  cacheKey: string,
  options: ResolvedKeyframeOptions,
): ExtractedKeyframe[] | null {
  let raw: string;

  try {
    raw = readFileSync(path.join(directory, CACHE_MANIFEST_FILE), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (parsed.version !== KEYFRAME_CACHE_VERSION || parsed.cacheKey !== cacheKey) {
    return null;
  }

  if (!isRecord(parsed.options)) {
    return null;
  }

  if (
    parsed.options.longEdge !== options.longEdge ||
    parsed.options.maxFrames !== options.maxFrames
  ) {
    return null;
  }

  if (!Array.isArray(parsed.frames) || parsed.frames.length === 0) {
    return null;
  }

  const frames: ExtractedKeyframe[] = [];

  for (const item of parsed.frames) {
    if (!isRecord(item)) {
      return null;
    }

    const { height, path: framePath, timeMs, width } = item;

    if (typeof framePath !== 'string' || framePath.length === 0) {
      return null;
    }

    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
      return null;
    }

    if (typeof timeMs !== 'number' || !Number.isInteger(timeMs) || timeMs < 0) {
      return null;
    }

    try {
      const stats = statSync(framePath);

      if (!stats.isFile() || stats.size <= 0) {
        return null;
      }
    } catch {
      return null;
    }

    frames.push({ height, path: framePath, timeMs, width });
  }

  return frames.sort((left, right) => left.timeMs - right.timeMs);
}

function cleanupDirectory(directory: string): void {
  try {
    rmSync(directory, { force: true, recursive: true });
  } catch {
    // 清理失败不影响主流程，保留缓存目录供下次覆盖。
  }
}

async function extractSingleFrame(
  sourcePath: string,
  timeMs: number,
  width: number,
  height: number,
  outputPath: string,
  options: ResolvedKeyframeOptions,
  runProcess: typeof runMediaProcess,
): Promise<void> {
  const result = await runProcess({
    binaryPath: options.ffmpegPath,
    args: buildFrameArgs(sourcePath, timeMs, width, height, outputPath),
    operation: 'extract',
    timeoutMs: options.timeoutMs,
    maxStdoutBytes: MAX_FRAME_STDOUT_BYTES,
    maxStderrBytes: MAX_FRAME_STDERR_BYTES,
  });

  if (result.exitCode !== 0) {
    throw new MediaError('MEDIA_PROCESS_FAILED', '关键帧提取失败。', true);
  }

  let stats: ReturnType<typeof statSync>;

  try {
    stats = statSync(outputPath);
  } catch {
    throw new MediaError('MEDIA_PROCESS_FAILED', '关键帧提取失败。', true);
  }

  if (!stats.isFile() || stats.size <= 0) {
    throw new MediaError('MEDIA_PROCESS_FAILED', '关键帧提取失败。', true);
  }
}

/**
 * 把临时目录提交为最终缓存目录。
 *
 * 若 rename 时发现目标已被并发写入，优先采用对方已写好的有效清单；
 * 否则清理目标后重试一次，仍失败则抛 MEDIA_OUTPUT_FAILED。
 */
function commitCache(
  tempDir: string,
  targetDir: string,
  cacheKey: string,
  options: ResolvedKeyframeOptions,
  manifest: KeyframeCacheManifest,
): { frames: ExtractedKeyframe[]; fromCache: boolean } {
  try {
    mkdirSync(path.dirname(targetDir), { recursive: true });
  } catch (error) {
    throw mapCacheWriteFailure(error);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }

      renameSync(tempDir, targetDir);
      return { frames: manifest.frames, fromCache: false };
    } catch (error) {
      lastError = error;

      const adopted = readCachedFrames(targetDir, cacheKey, options);

      if (adopted) {
        cleanupDirectory(tempDir);
        return { frames: adopted, fromCache: true };
      }
    }
  }

  throw mapCacheWriteFailure(lastError);
}

/**
 * 提取关键帧；缓存命中直接返回。单帧失败会跳过，全部失败才抛 MediaError。
 *
 * 缓存按文件内容 SHA-256 分桶，命中要求清单版本、抽帧选项一致，
 * 且所有帧文件仍然存在且非空。
 */
export async function extractKeyframes(
  source: KeyframeSource,
  options: KeyframeOptions,
  deps: KeyframeExtractorDeps = {},
): Promise<KeyframeExtractionResult> {
  const resolved = resolveOptions(options);
  const hashFile = deps.hashFile ?? hashFileSha256;
  const runProcess = deps.runProcess ?? runMediaProcess;

  let cacheKey: string;

  try {
    cacheKey = await hashFile(source.path);
  } catch (error) {
    throw mapReadFailure(error);
  }

  const targetDir = getCacheDirectory(resolved.cacheRoot, cacheKey);
  const cachedFrames = readCachedFrames(targetDir, cacheKey, resolved);

  if (cachedFrames) {
    return { cacheKey, frames: cachedFrames, fromCache: true };
  }

  const timestamps = planKeyframeTimestamps(source.durationMs, resolved.maxFrames);

  if (timestamps.length === 0) {
    throw new MediaError('MEDIA_CORRUPTED', '视频时长无效，无法提取关键帧。', false);
  }

  const size = computeScaledSize(source.width, source.height, resolved.longEdge);
  const tempDir = path.join(resolved.cacheRoot, `.tmp-${cacheKey}-${randomUUID()}`);
  const frames: ExtractedKeyframe[] = [];
  let firstError: unknown;
  let committed = false;

  try {
    try {
      mkdirSync(tempDir, { recursive: true });
    } catch (error) {
      throw mapCacheWriteFailure(error);
    }

    for (const [index, timeMs] of timestamps.entries()) {
      const fileName = buildFrameFileName(index, timeMs);
      const outputPath = path.join(tempDir, fileName);

      try {
        await extractSingleFrame(
          source.path,
          timeMs,
          size.width,
          size.height,
          outputPath,
          resolved,
          runProcess,
        );

        frames.push({
          height: size.height,
          path: path.join(targetDir, fileName),
          timeMs,
          width: size.width,
        });
      } catch (error) {
        // 单帧失败（损坏片段、超时等）不阻断其余帧。
        if (firstError === undefined) {
          firstError = error;
        }
      }
    }

    if (frames.length === 0) {
      throw mapFrameFailure(firstError);
    }

    const manifest: KeyframeCacheManifest = {
      version: KEYFRAME_CACHE_VERSION,
      cacheKey,
      createdAt: new Date().toISOString(),
      options: { longEdge: resolved.longEdge, maxFrames: resolved.maxFrames },
      source: { width: source.width, height: source.height },
      frames,
    };

    try {
      writeFileSync(
        path.join(tempDir, CACHE_MANIFEST_FILE),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
    } catch (error) {
      throw mapCacheWriteFailure(error);
    }

    const committedResult = commitCache(tempDir, targetDir, cacheKey, resolved, manifest);
    committed = true;
    return { cacheKey, frames: committedResult.frames, fromCache: committedResult.fromCache };
  } finally {
    if (!committed) {
      cleanupDirectory(tempDir);
    }
  }
}

function mapFrameFailure(error: unknown): MediaError {
  if (error instanceof MediaError) {
    return error;
  }

  return new MediaError('MEDIA_PROCESS_FAILED', '关键帧提取失败。', true);
}
