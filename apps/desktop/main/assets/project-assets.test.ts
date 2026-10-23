import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
const METADATA = { durationMs: 5000, fps: 30, height: 1080, width: 1920 };

let directory: string;

function writeFile(name: string, content: Buffer): string {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, content);
  return filePath;
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

    const prepared = await prepareProjectAssets(directory, async () => METADATA);

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
  });

  it('accepts a single video file path', async () => {
    const video = writeFile('clip.mp4', MP4);

    const prepared = await prepareProjectAssets(video, async () => METADATA);

    expect(prepared.assets.videos[0]?.path).toBe(video);
  });

  it('rejects a directory without videos', async () => {
    writeFile('photo.jpg', JPEG);

    await expect(prepareProjectAssets(directory, async () => METADATA)).rejects.toMatchObject({
      code: 'ASSET_NO_VIDEOS',
    });
  });

  it('rejects a missing path', async () => {
    await expect(
      prepareProjectAssets(path.join(directory, 'missing'), async () => METADATA),
    ).rejects.toMatchObject({ code: 'ASSET_PATH_NOT_FOUND' });
  });

  it('rejects relative paths', async () => {
    await expect(prepareProjectAssets('relative/path', async () => METADATA)).rejects.toMatchObject(
      { code: 'ASSET_INVALID_ARGUMENT' },
    );
  });

  it('rejects when every video fails metadata probing', async () => {
    writeFile('clip.mp4', MP4);

    await expect(prepareProjectAssets(directory, async () => null)).rejects.toMatchObject({
      code: 'ASSET_PROBE_FAILED',
    });
  });

  it('imports the videos that probe successfully', async () => {
    writeFile('good.mp4', MP4);
    writeFile('bad.mp4', MP4);

    const prepared = await prepareProjectAssets(directory, async (candidate) =>
      candidate.fileName === 'good.mp4' ? METADATA : null,
    );

    expect(prepared.assets.videos).toHaveLength(1);
    expect(prepared.assets.videos[0]?.path).toBe(path.join(directory, 'good.mp4'));
  });

  it('strips surrounding quotes from the entered path', async () => {
    const video = writeFile('clip.mp4', MP4);

    const prepared = await prepareProjectAssets(`"${video}"`, async () => METADATA);

    expect(prepared.assets.videos[0]?.path).toBe(video);
  });
});
