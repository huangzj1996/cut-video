import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaError, type VideoProbeResult } from '@miaoma/video-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssetSelectionManifest, prepareProjectAssets } from './project-assets';

const MP4 = (() => {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
})();
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const METADATA = {
  bitRate: 1_000_000,
  codec: 'h264',
  container: 'mov,mp4',
  durationMs: 5000,
  fps: 30,
  height: 1080,
  isHdr: false,
  isVfr: false,
  pixelFormat: 'yuv420p',
  profile: 'High',
  rotation: 0,
  width: 1920,
};

let directory: string;

function writeFile(name: string, content: Buffer): string {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, content);
  return filePath;
}

function successfulProbe(): VideoProbeResult {
  return { metadata: METADATA, ok: true };
}

function failedProbe(): VideoProbeResult {
  return {
    error: new MediaError('MEDIA_CORRUPTED', '媒体文件已损坏或无法解码。'),
    ok: false,
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'miaoma-project-assets-'));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('prepareProjectAssets', () => {
  it('scans a directory, probes videos, and keeps non-video files in the manifest', async () => {
    const video = writeFile('clip.mp4', MP4);
    writeFile('photo.jpg', JPEG);

    const prepared = await prepareProjectAssets(directory, async () => successfulProbe());

    expect(prepared.assets.videos).toHaveLength(1);
    expect(prepared.assets.videos[0]).toMatchObject({
      durationMs: 5000,
      fps: 30,
      height: 1080,
      mediaType: 'video',
      path: video,
      thumbnailIds: [],
      width: 1920,
    });
    expect(prepared.assets.music).toEqual([]);
    expect(prepared.assets.voices).toEqual([]);
    expect(prepared.roots).toEqual([directory]);

    const manifest = buildAssetSelectionManifest('project-1', prepared);
    expect(manifest.projectId).toBe('project-1');
    expect(manifest.roots).toEqual([directory]);
    expect(manifest.items.map((item) => item.fileName).sort()).toEqual(['clip.mp4', 'photo.jpg']);

    expect(prepared.probeErrors.size).toBe(0);

    const videoItem = manifest.items.find((item) => item.fileName === 'clip.mp4');
    expect(videoItem?.probe).toMatchObject({
      codec: 'h264',
      durationMs: 5000,
      rotation: 0,
    });
    expect(videoItem && 'probeError' in videoItem).toBe(false);
  });

  it('accepts a single video file path', async () => {
    const video = writeFile('clip.mp4', MP4);

    const prepared = await prepareProjectAssets(video, async () => successfulProbe());

    expect(prepared.assets.videos[0]?.path).toBe(video);
  });

  it('rejects a directory without videos', async () => {
    writeFile('photo.jpg', JPEG);

    await expect(
      prepareProjectAssets(directory, async () => successfulProbe()),
    ).rejects.toMatchObject({ code: 'ASSET_NO_VIDEOS' });
  });

  it('rejects a missing path', async () => {
    await expect(
      prepareProjectAssets(path.join(directory, 'missing'), async () => successfulProbe()),
    ).rejects.toMatchObject({ code: 'ASSET_PATH_NOT_FOUND' });
  });

  it('rejects relative paths', async () => {
    await expect(
      prepareProjectAssets('relative/path', async () => successfulProbe()),
    ).rejects.toMatchObject({ code: 'ASSET_INVALID_ARGUMENT' });
  });

  it('rejects when every video fails metadata probing', async () => {
    writeFile('clip.mp4', MP4);

    await expect(prepareProjectAssets(directory, async () => failedProbe())).rejects.toMatchObject({
      code: 'ASSET_PROBE_FAILED',
    });
  });

  it('imports the videos that probe successfully', async () => {
    writeFile('good.mp4', MP4);
    writeFile('bad.mp4', MP4);

    const prepared = await prepareProjectAssets(directory, async (candidate) =>
      candidate.fileName === 'good.mp4' ? successfulProbe() : failedProbe(),
    );

    expect(prepared.assets.videos).toHaveLength(1);
    expect(prepared.assets.videos[0]?.path).toBe(path.join(directory, 'good.mp4'));
  });

  it('records probe errors in the manifest while importing successful videos', async () => {
    const goodVideo = writeFile('good.mp4', MP4);
    writeFile('broken.mp4', MP4);

    const prepared = await prepareProjectAssets(directory, async (candidate) =>
      candidate.fileName === 'good.mp4' ? successfulProbe() : failedProbe(),
    );

    expect(prepared.assets.videos).toHaveLength(1);
    expect(prepared.assets.videos[0]?.path).toBe(goodVideo);
    expect(prepared.probeErrors.size).toBe(1);

    const manifest = buildAssetSelectionManifest('project-1', prepared);
    const brokenItem = manifest.items.find((item) => item.fileName === 'broken.mp4');
    const goodItem = manifest.items.find((item) => item.fileName === 'good.mp4');

    expect(brokenItem?.probe).toBeUndefined();
    expect(brokenItem?.probeError).toEqual({
      code: 'MEDIA_CORRUPTED',
      message: '媒体文件已损坏或无法解码。',
      retryable: false,
    });
    expect(goodItem && 'probeError' in goodItem).toBe(false);
  });

  it('records keyframe cache details in the manifest', async () => {
    writeFile('clip.mp4', MP4);

    const prepared = await prepareProjectAssets(directory, async () => successfulProbe());
    const candidate = prepared.scanResult.candidates.find((item) => item.fileName === 'clip.mp4');
    expect(candidate).toBeDefined();

    const manifest = buildAssetSelectionManifest('project-1', prepared, {
      keyframeCacheKeys: new Map([[candidate!.pathKey, 'content-hash']]),
      keyframeCounts: new Map([[candidate!.pathKey, 3]]),
      keyframeErrors: new Map(),
    });
    const item = manifest.items.find((entry) => entry.fileName === 'clip.mp4');

    expect(item?.keyframeCacheKey).toBe('content-hash');
    expect(item?.keyframeCount).toBe(3);
    expect(item && 'keyframeError' in item).toBe(false);
  });

  it('records keyframe extraction errors without dropping the video', async () => {
    writeFile('clip.mp4', MP4);

    const prepared = await prepareProjectAssets(directory, async () => successfulProbe());
    const candidate = prepared.scanResult.candidates.find((item) => item.fileName === 'clip.mp4');
    expect(candidate).toBeDefined();
    const keyframeError = {
      code: 'MEDIA_TIMEOUT' as const,
      message: '媒体处理超时。',
      retryable: true,
    };

    const manifest = buildAssetSelectionManifest('project-1', prepared, {
      keyframeErrors: new Map([[candidate!.pathKey, keyframeError]]),
    });
    const item = manifest.items.find((entry) => entry.fileName === 'clip.mp4');

    expect(item?.keyframeError).toEqual(keyframeError);
    expect(item && 'keyframeCacheKey' in item).toBe(false);
    expect(item && 'keyframeCount' in item).toBe(false);
  });

  it('falls back to MEDIA_PROCESS_FAILED when the probe throws', async () => {
    writeFile('good.mp4', MP4);
    writeFile('broken.mp4', MP4);

    const prepared = await prepareProjectAssets(directory, async (candidate) => {
      if (candidate.fileName === 'good.mp4') {
        return successfulProbe();
      }

      throw new Error('probe crashed');
    });

    const manifest = buildAssetSelectionManifest('project-1', prepared);
    const brokenItem = manifest.items.find((item) => item.fileName === 'broken.mp4');

    expect(brokenItem?.probeError).toEqual({
      code: 'MEDIA_PROCESS_FAILED',
      message: '媒体处理失败。',
      retryable: true,
    });
  });

  it('strips surrounding quotes from the entered path', async () => {
    const video = writeFile('clip.mp4', MP4);

    const prepared = await prepareProjectAssets(`"${video}"`, async () => successfulProbe());

    expect(prepared.assets.videos[0]?.path).toBe(video);
  });
});
