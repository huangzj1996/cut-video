import { describe, expect, it, vi } from 'vitest';
import { MediaError, type KeyframeExtractionResult, type VideoMetadata } from '@miaoma/video-agent';
import type { VideoAsset } from '@miaoma/video-project';
import { attachKeyframes } from './keyframe-assets';
import { toPathKey } from './path-key';
import type { PreparedProjectAssets } from './project-assets';

const METADATA: VideoMetadata = {
  durationMs: 5000,
  fps: 30,
  height: 1080,
  isHdr: false,
  isVfr: false,
  rotation: 0,
  width: 1920,
};

function createVideo(id: string, videoPath: string): VideoAsset {
  return {
    durationMs: 5000,
    fps: 30,
    height: 1080,
    id,
    mediaType: 'video',
    path: videoPath,
    thumbnailIds: [],
    width: 1920,
  };
}

function createPrepared(
  videos: VideoAsset[],
  probes: Map<string, VideoMetadata>,
): PreparedProjectAssets {
  return {
    assets: {
      music: [],
      subtitles: [],
      thumbnails: [],
      videos,
      voices: [],
    },
    probeErrors: new Map(),
    probes,
    roots: ['C:/media'],
    scanResult: {
      cancelled: false,
      candidates: [],
      issues: [],
      stats: {
        directoriesVisited: 0,
        duplicates: 0,
        elapsedMs: 0,
        extensionMatches: 0,
        extensionSkipped: 0,
        filesSeen: 0,
        ignoredDirectories: 0,
        magicMatches: 0,
        rejected: 0,
        rootsScanned: 1,
        symlinksSkipped: 0,
      },
    },
  };
}

function framesResult(
  frames: KeyframeExtractionResult['frames'],
  cacheKey = 'hash-a',
): KeyframeExtractionResult {
  return { cacheKey, frames, fromCache: false };
}

describe('attachKeyframes', () => {
  it('maps frames to thumbnail assets and video references', async () => {
    const video = createVideo('video-1', 'C:/media/a.mp4');
    const pathKey = toPathKey(video.path);
    const prepared = createPrepared([video], new Map([[pathKey, METADATA]]));
    const extract = vi.fn(async () =>
      framesResult([
        {
          height: 432,
          path: 'C:/project/cache/keyframes/frame-01-1000ms.jpg',
          timeMs: 1000,
          width: 768,
        },
        {
          height: 432,
          path: 'C:/project/cache/keyframes/frame-02-4000ms.jpg',
          timeMs: 4000,
          width: 768,
        },
      ]),
    );

    const attached = await attachKeyframes(prepared, extract);

    expect(extract).toHaveBeenCalledWith({
      durationMs: 5000,
      height: 1080,
      path: 'C:/media/a.mp4',
      width: 1920,
    });
    expect(attached.assets.thumbnails).toHaveLength(2);
    expect(attached.assets.thumbnails[0]).toMatchObject({
      height: 432,
      path: 'C:/project/cache/keyframes/frame-01-1000ms.jpg',
      timeMs: 1000,
      width: 768,
    });

    const videoIds = attached.assets.videos[0]?.thumbnailIds ?? [];
    expect(videoIds).toHaveLength(2);
    expect(new Set(videoIds)).toEqual(
      new Set(attached.assets.thumbnails.map((thumbnail) => thumbnail.id)),
    );
    expect(attached.cacheKeys.get(pathKey)).toBe('hash-a');
    expect(attached.frameCounts.get(pathKey)).toBe(2);
    expect(attached.errors.size).toBe(0);

    // 不修改入参，方便创建流程继续用原始探测结果写清单。
    expect(prepared.assets.videos[0]?.thumbnailIds).toEqual([]);
    expect(prepared.assets.thumbnails).toEqual([]);
  });

  it('keeps the video and records the error when extraction fails', async () => {
    const video = createVideo('video-1', 'C:/media/broken.mp4');
    const pathKey = toPathKey(video.path);
    const prepared = createPrepared([video], new Map([[pathKey, METADATA]]));
    const extract = async (): Promise<KeyframeExtractionResult> => {
      throw new MediaError('MEDIA_CORRUPTED', '媒体文件已损坏或无法解码。');
    };

    const attached = await attachKeyframes(prepared, extract);

    expect(attached.assets.videos).toHaveLength(1);
    expect(attached.assets.videos[0]?.thumbnailIds).toEqual([]);
    expect(attached.assets.thumbnails).toEqual([]);
    expect(attached.errors.get(pathKey)).toEqual({
      code: 'MEDIA_CORRUPTED',
      message: '媒体文件已损坏或无法解码。',
      retryable: false,
    });
    expect(attached.cacheKeys.has(pathKey)).toBe(false);
    expect(attached.frameCounts.has(pathKey)).toBe(false);
  });

  it('isolates failures between videos', async () => {
    const good = createVideo('video-good', 'C:/media/good.mp4');
    const bad = createVideo('video-bad', 'C:/media/bad.mp4');
    const prepared = createPrepared(
      [good, bad],
      new Map([
        [toPathKey(good.path), METADATA],
        [toPathKey(bad.path), METADATA],
      ]),
    );
    const extract = async (source: { path: string }): Promise<KeyframeExtractionResult> => {
      if (source.path === bad.path) {
        throw new MediaError('MEDIA_TIMEOUT', '媒体处理超时。', true);
      }

      return framesResult(
        [
          {
            height: 432,
            path: 'C:/project/cache/keyframes/frame-01-2500ms.jpg',
            timeMs: 2500,
            width: 768,
          },
        ],
        'hash-good',
      );
    };

    const attached = await attachKeyframes(prepared, extract);

    expect(attached.assets.videos.map((video) => video.thumbnailIds.length)).toEqual([1, 0]);
    expect(attached.assets.thumbnails).toHaveLength(1);
    expect(attached.errors.get(toPathKey(bad.path))?.code).toBe('MEDIA_TIMEOUT');
    expect(attached.cacheKeys.get(toPathKey(good.path))).toBe('hash-good');
    expect(attached.frameCounts.get(toPathKey(good.path))).toBe(1);
  });

  it('skips extraction when probe metadata is missing', async () => {
    const video = createVideo('video-1', 'C:/media/unknown.mp4');
    const prepared = createPrepared([video], new Map());
    const extract = vi.fn(async () => framesResult([]));

    const attached = await attachKeyframes(prepared, extract);

    expect(extract).not.toHaveBeenCalled();
    expect(attached.assets.videos[0]?.thumbnailIds).toEqual([]);
    expect(attached.errors.size).toBe(0);
  });

  it('normalizes unexpected errors into a safe summary', async () => {
    const video = createVideo('video-1', 'C:/media/a.mp4');
    const pathKey = toPathKey(video.path);
    const prepared = createPrepared([video], new Map([[pathKey, METADATA]]));
    const extract = async (): Promise<KeyframeExtractionResult> => {
      throw new Error('raw internal failure with C:/secret/path');
    };

    const attached = await attachKeyframes(prepared, extract);

    expect(attached.errors.get(pathKey)).toEqual({
      code: 'MEDIA_PROCESS_FAILED',
      message: '媒体处理失败。',
      retryable: true,
    });
  });
});
