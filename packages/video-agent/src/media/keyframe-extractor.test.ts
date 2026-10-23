import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ExtractedKeyframe,
  KeyframeExtractionResult,
  KeyframeExtractorDeps,
  KeyframeOptions,
  KeyframeSource,
} from './keyframe-extractor';
import {
  computeScaledSize,
  extractKeyframes,
  KEYFRAME_CACHE_VERSION,
  planKeyframeTimestamps,
} from './keyframe-extractor';
import { MediaError } from './media-error';
import type { RunMediaProcessOptions } from './media-error';

const CACHE_KEY = 'a'.repeat(64);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const SOURCE: KeyframeSource = {
  durationMs: 12_000,
  height: 1080,
  path: 'C:\\videos\\clip.mp4',
  width: 1920,
};

type RunProcess = NonNullable<KeyframeExtractorDeps['runProcess']>;

interface FakeProcess {
  calls: RunMediaProcessOptions[];
  runProcess: RunProcess;
}

let directory: string;

function options(overrides: Partial<KeyframeOptions> = {}): KeyframeOptions {
  return {
    cacheRoot: directory,
    ffmpegPath: 'ffmpeg',
    ...overrides,
  };
}

function cacheDirectory(): string {
  return path.join(directory, CACHE_KEY.slice(0, 2), CACHE_KEY);
}

function requireLastArg(args: string[]): string {
  const value = args.at(-1);

  if (value === undefined) {
    throw new Error('ffmpeg 参数缺少输出路径');
  }

  return value;
}

function createFakeProcess(handler?: (call: RunMediaProcessOptions) => void): FakeProcess {
  const calls: RunMediaProcessOptions[] = [];
  const runProcess: RunProcess = async (call) => {
    calls.push(call);
    handler?.(call);
    writeFileSync(requireLastArg(call.args), JPEG_BYTES);
    return { exitCode: 0, stderr: '', stdout: '' };
  };

  return { calls, runProcess };
}

function getCall(fake: FakeProcess, index: number): RunMediaProcessOptions {
  const call = fake.calls[index];

  if (call === undefined) {
    throw new Error(`缺少第 ${index} 次 ffmpeg 调用`);
  }

  return call;
}

function getFrame(result: KeyframeExtractionResult, index: number): ExtractedKeyframe {
  const frame = result.frames[index];

  if (frame === undefined) {
    throw new Error(`缺少第 ${index} 帧`);
  }

  return frame;
}

function listTempDirectories(): string[] {
  try {
    return readdirSync(directory).filter((name) => name.startsWith('.tmp-'));
  } catch {
    return [];
  }
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'miaoma-keyframes-'));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('planKeyframeTimestamps', () => {
  it('returns no timestamps for invalid durations', () => {
    for (const duration of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(planKeyframeTimestamps(duration)).toEqual([]);
    }
  });

  it('targets one frame per five seconds and caps at eight', () => {
    expect(planKeyframeTimestamps(2000)).toEqual([1000]);
    expect(planKeyframeTimestamps(5000)).toEqual([2500]);
    expect(planKeyframeTimestamps(12000)).toEqual([3000, 9000]);
    expect(planKeyframeTimestamps(20000)).toEqual([2500, 7500, 12500, 17500]);
    expect(planKeyframeTimestamps(40000)).toEqual([
      2500, 7500, 12500, 17500, 22500, 27500, 32500, 37500,
    ]);
    expect(planKeyframeTimestamps(10 * 60 * 1000)).toHaveLength(8);
  });

  it('honours caller limits and clamps them to 1..8', () => {
    expect(planKeyframeTimestamps(10000, 1)).toEqual([5000]);
    expect(planKeyframeTimestamps(100000, 2)).toEqual([25000, 75000]);
    expect(planKeyframeTimestamps(100000, 100)).toHaveLength(8);
    expect(planKeyframeTimestamps(10000, 0)).toEqual([5000]);
    expect(planKeyframeTimestamps(10000, -3)).toEqual([5000]);
  });

  it('places timestamps at the centres of odd segments', () => {
    expect(planKeyframeTimestamps(15000, 3)).toEqual([2500, 7500, 12500]);
  });

  it('keeps every timestamp an ascending integer below the duration', () => {
    for (const duration of [1, 7, 999, 5001, 12345, 599999]) {
      const timestamps = planKeyframeTimestamps(duration);

      expect(timestamps.length).toBeGreaterThanOrEqual(1);
      expect(timestamps.length).toBeLessThanOrEqual(8);
      expect(new Set(timestamps).size).toBe(timestamps.length);
      expect([...timestamps].sort((left, right) => left - right)).toEqual(timestamps);

      for (const timeMs of timestamps) {
        expect(Number.isInteger(timeMs)).toBe(true);
        expect(timeMs).toBeGreaterThanOrEqual(0);
        expect(timeMs).toBeLessThan(duration);
      }
    }
  });

  it('returns 0 for a 1 ms video', () => {
    expect(planKeyframeTimestamps(1)).toEqual([0]);
  });
});

describe('computeScaledSize', () => {
  it('scales landscape, portrait and square videos to the long edge', () => {
    expect(computeScaledSize(1920, 1080)).toEqual({ width: 768, height: 432 });
    expect(computeScaledSize(1080, 1920)).toEqual({ width: 432, height: 768 });
    expect(computeScaledSize(1000, 1000)).toEqual({ width: 768, height: 768 });
  });

  it('never upscales small sources', () => {
    expect(computeScaledSize(320, 240)).toEqual({ width: 320, height: 240 });
    expect(computeScaledSize(768, 500)).toEqual({ width: 768, height: 500 });
  });

  it('clamps longEdge into 1..768', () => {
    expect(computeScaledSize(4000, 3000, 2000)).toEqual({ width: 768, height: 576 });
    expect(computeScaledSize(1920, 1080, 500)).toEqual({ width: 500, height: 281 });
    expect(computeScaledSize(1920, 1080, 0)).toEqual({ width: 1, height: 1 });
  });

  it('rounds dimensions to integers and keeps them at least 1', () => {
    expect(computeScaledSize(1000, 333)).toEqual({ width: 768, height: 256 });
    expect(computeScaledSize(10000, 1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('falls back to 1x1 for invalid dimensions', () => {
    expect(computeScaledSize(0, 100)).toEqual({ width: 1, height: 1 });
    expect(computeScaledSize(-1, 100)).toEqual({ width: 1, height: 1 });
    expect(computeScaledSize(Number.NaN, 100)).toEqual({ width: 1, height: 1 });
    expect(computeScaledSize(Number.POSITIVE_INFINITY, 100)).toEqual({ width: 1, height: 1 });
    expect(computeScaledSize(100, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('extractKeyframes', () => {
  it('extracts planned frames with the expected ffmpeg arguments and writes a manifest', async () => {
    const fake = createFakeProcess();
    const result = await extractKeyframes(SOURCE, options(), {
      hashFile: async () => CACHE_KEY,
      runProcess: fake.runProcess,
    });

    expect(result.fromCache).toBe(false);
    expect(result.cacheKey).toBe(CACHE_KEY);
    expect(result.frames).toHaveLength(2);
    expect(result.frames.map((frame) => frame.timeMs)).toEqual([3000, 9000]);
    expect(result.frames.map((frame) => path.basename(frame.path))).toEqual([
      'frame-01-3000ms.jpg',
      'frame-02-9000ms.jpg',
    ]);

    for (const frame of result.frames) {
      expect(frame.width).toBe(768);
      expect(frame.height).toBe(432);
      expect(path.isAbsolute(frame.path)).toBe(true);
      expect(statSync(frame.path).size).toBe(JPEG_BYTES.length);
      expect(readFileSync(frame.path)).toEqual(JPEG_BYTES);
    }

    expect(fake.calls).toHaveLength(2);
    const firstCall = getCall(fake, 0);
    const firstArgs = firstCall.args;

    expect(firstCall.binaryPath).toBe('ffmpeg');
    expect(firstCall.operation).toBe('extract');
    expect(firstCall.timeoutMs).toBe(30_000);
    expect(firstCall.maxStdoutBytes).toBe(64 * 1024);
    expect(firstCall.maxStderrBytes).toBe(256 * 1024);
    expect(firstArgs).toHaveLength(18);
    expect(firstArgs.slice(0, 6)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-ss',
      '3.000',
    ]);
    expect(firstArgs.slice(6, 8)).toEqual(['-i', SOURCE.path]);
    expect(firstArgs.slice(8, 14)).toEqual([
      '-frames:v',
      '1',
      '-an',
      '-sn',
      '-vf',
      'scale=768:432:flags=lanczos',
    ]);
    expect(firstArgs.slice(14, 17)).toEqual(['-q:v', '3', '-y']);
    expect(path.basename(requireLastArg(firstArgs))).toBe('frame-01-3000ms.jpg');
    expect(getCall(fake, 1).args[5]).toBe('9.000');

    const manifest = JSON.parse(
      readFileSync(path.join(cacheDirectory(), 'keyframes.json'), 'utf8'),
    ) as {
      cacheKey: string;
      createdAt: string;
      frames: ExtractedKeyframe[];
      options: { longEdge: number; maxFrames: number };
      source: { width: number; height: number };
      version: number;
    };

    expect(manifest.version).toBe(KEYFRAME_CACHE_VERSION);
    expect(manifest.cacheKey).toBe(CACHE_KEY);
    expect(manifest.options).toEqual({ longEdge: 768, maxFrames: 8 });
    expect(manifest.source).toEqual({ width: 1920, height: 1080 });
    expect(typeof manifest.createdAt).toBe('string');
    expect(manifest.frames).toHaveLength(2);
    expect(manifest.frames[0]?.path).toBe(getFrame(result, 0).path);

    const second = await extractKeyframes(SOURCE, options(), {
      hashFile: async () => CACHE_KEY,
      runProcess: fake.runProcess,
    });

    expect(second.fromCache).toBe(true);
    expect(second.frames).toEqual(result.frames);
    expect(fake.calls).toHaveLength(2);
  });

  it('re-extracts when a cached frame file is missing', async () => {
    const fake = createFakeProcess();
    const deps = { hashFile: async () => CACHE_KEY, runProcess: fake.runProcess };
    const first = await extractKeyframes(SOURCE, options(), deps);

    rmSync(getFrame(first, 0).path);

    const second = await extractKeyframes(SOURCE, options(), deps);

    expect(second.fromCache).toBe(false);
    expect(second.frames).toHaveLength(2);
    expect(fake.calls).toHaveLength(4);
    expect(statSync(getFrame(second, 0).path).size).toBeGreaterThan(0);
  });

  it('does not share cache entries across longEdge or maxFrames changes', async () => {
    const fake = createFakeProcess();
    const deps = { hashFile: async () => CACHE_KEY, runProcess: fake.runProcess };

    const full = await extractKeyframes(SOURCE, options(), deps);
    expect(full.frames.map((frame) => frame.width)).toEqual([768, 768]);

    const scaledDown = await extractKeyframes(SOURCE, options({ longEdge: 500 }), deps);
    expect(scaledDown.fromCache).toBe(false);
    expect(scaledDown.frames.map((frame) => frame.width)).toEqual([500, 500]);
    expect(scaledDown.frames.map((frame) => frame.height)).toEqual([281, 281]);

    const singleFrame = await extractKeyframes(SOURCE, options({ maxFrames: 1 }), deps);
    expect(singleFrame.fromCache).toBe(false);
    expect(singleFrame.frames).toHaveLength(1);
    expect(singleFrame.frames[0]?.timeMs).toBe(6000);

    const repeated = await extractKeyframes(SOURCE, options({ maxFrames: 1 }), deps);
    expect(repeated.fromCache).toBe(true);
    expect(repeated.frames).toEqual(singleFrame.frames);
  });

  it('uses cached frame sizes when the same content reports different dimensions', async () => {
    const fake = createFakeProcess();
    const deps = { hashFile: async () => CACHE_KEY, runProcess: fake.runProcess };

    await extractKeyframes(SOURCE, options(), deps);

    const rotated: KeyframeSource = { ...SOURCE, width: 1080, height: 1920 };
    const second = await extractKeyframes(rotated, options(), deps);

    expect(second.fromCache).toBe(true);
    expect(second.frames.map((frame) => [frame.width, frame.height])).toEqual([
      [768, 432],
      [768, 432],
    ]);
    expect(fake.calls).toHaveLength(2);
  });

  it('skips a failed frame and returns the remaining frames', async () => {
    const fake = createFakeProcess((call) => {
      if (call.args.includes('3.000')) {
        throw new MediaError('MEDIA_CORRUPTED', '模拟损坏。', false);
      }
    });

    const result = await extractKeyframes(SOURCE, options(), {
      hashFile: async () => CACHE_KEY,
      runProcess: fake.runProcess,
    });

    expect(result.fromCache).toBe(false);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.timeMs).toBe(9000);
    expect(path.basename(getFrame(result, 0).path)).toBe('frame-02-9000ms.jpg');
    expect(fake.calls).toHaveLength(2);
  });

  it('throws the first MediaError and cleans temp files when every frame fails', async () => {
    const fake = createFakeProcess(() => {
      throw new MediaError('MEDIA_CORRUPTED', '模拟损坏。', false);
    });

    await expect(
      extractKeyframes(SOURCE, options(), {
        hashFile: async () => CACHE_KEY,
        runProcess: fake.runProcess,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CORRUPTED', message: '模拟损坏。' });

    expect(fake.calls).toHaveLength(2);
    expect(listTempDirectories()).toEqual([]);
  });

  it('wraps unknown frame failures as MEDIA_PROCESS_FAILED', async () => {
    const fake = createFakeProcess(() => {
      throw new Error('unexpected');
    });

    await expect(
      extractKeyframes(SOURCE, options(), {
        hashFile: async () => CACHE_KEY,
        runProcess: fake.runProcess,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_PROCESS_FAILED' });

    expect(listTempDirectories()).toEqual([]);
  });

  it('caps extraction at eight frames when callers ask for more', async () => {
    const fake = createFakeProcess();
    const result = await extractKeyframes(
      { ...SOURCE, durationMs: 60_000 },
      options({ maxFrames: 100 }),
      { hashFile: async () => CACHE_KEY, runProcess: fake.runProcess },
    );

    expect(result.frames).toHaveLength(8);
    expect(fake.calls).toHaveLength(8);
  });

  it('hashes the source content with SHA-256 by default', async () => {
    const sourcePath = path.join(directory, 'clip.mp4');
    writeFileSync(sourcePath, 'magicut');
    const fake = createFakeProcess();

    const result = await extractKeyframes(
      { ...SOURCE, durationMs: 5000, path: sourcePath },
      options(),
      { runProcess: fake.runProcess },
    );

    expect(result.cacheKey).toBe(createHash('sha256').update('magicut').digest('hex'));
    expect(result.cacheKey).toHaveLength(64);
  });

  it('maps a missing source file to MEDIA_INPUT_NOT_FOUND', async () => {
    const fake = createFakeProcess();

    await expect(
      extractKeyframes({ ...SOURCE, path: path.join(directory, 'missing.mp4') }, options(), {
        runProcess: fake.runProcess,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_INPUT_NOT_FOUND' });

    expect(fake.calls).toHaveLength(0);
  });

  it('rejects videos with no usable duration', async () => {
    const fake = createFakeProcess();

    await expect(
      extractKeyframes({ ...SOURCE, durationMs: 0 }, options(), {
        hashFile: async () => CACHE_KEY,
        runProcess: fake.runProcess,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CORRUPTED' });

    expect(fake.calls).toHaveLength(0);
    expect(listTempDirectories()).toEqual([]);
  });
});
