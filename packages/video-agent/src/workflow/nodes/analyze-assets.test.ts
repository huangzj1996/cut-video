import { describe, expect, it } from 'vitest';
import { AssetManifestSchema } from '@miaoma/video-project';
import { analyzeAssets } from './analyze-assets';
import { summarizeAnalyzedAssets } from './asset-summary';

const NOW = '2026-10-24T00:00:00.000Z';

function manifest() {
  return AssetManifestSchema.parse({
    schemaVersion: '1.0.0',
    manifestVersion: 1,
    projectId: 'project-1',
    scannedAt: NOW,
    roots: ['C:/assets'],
    items: [
      {
        assetId: 'asset-1',
        kind: 'video',
        path: 'C:/assets/city-night.mp4',
        fileName: 'city-night.mp4',
        sizeBytes: 1_000,
        mtimeMs: 1,
        status: 'ready',
        probe: {
          durationMs: 12_000,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
          isVfr: false,
          rotation: 0,
        },
        keyframes: [
          {
            thumbnailId: 'thumb-1',
            path: 'C:/assets/thumb-1.jpg',
            timeMs: 1_000,
            width: 768,
            height: 432,
          },
        ],
        issues: [],
      },
      {
        assetId: null,
        kind: 'video',
        path: 'C:/assets/broken.mp4',
        fileName: 'broken.mp4',
        sizeBytes: 10,
        mtimeMs: 1,
        status: 'rejected',
        keyframes: [],
        issues: [{ code: 'MAGIC_MISMATCH', message: '文件头不支持。' }],
      },
      {
        assetId: null,
        kind: 'audio',
        path: 'C:/assets/music.mp3',
        fileName: 'music.mp3',
        sizeBytes: 10,
        mtimeMs: 1,
        status: 'ready',
        keyframes: [],
        issues: [],
      },
    ],
    stats: {
      filesSeen: 3,
      directoriesVisited: 1,
      duplicates: 0,
      rejected: 1,
      unreadable: 0,
    },
    issues: [],
  });
}

describe('analyzeAssets', () => {
  it('produces technical descriptions and isolates failures', () => {
    const result = analyzeAssets(manifest(), 0, NOW);

    expect(result.analysisVersion).toBe(1);
    expect(result.analysisSource).toBe('technical');
    expect(result.assets).toHaveLength(1);
    expect(result.failures).toHaveLength(2);
    expect(result.assets[0]?.tags).toEqual(
      expect.arrayContaining(['横屏', '1920x1080', '含音轨', 'city', 'night']),
    );
    expect(result.assets[0]?.description).toContain('1920x1080');
    expect(result.assets[0]?.description).toContain('12 秒');
    expect(result.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining(['ASSET_REJECTED', 'UNSUPPORTED_ASSET_KIND']),
    );
  });

  it('summarizes assets without leaking absolute paths', () => {
    const result = analyzeAssets(manifest(), 0, NOW);
    const summary = summarizeAnalyzedAssets(result);

    expect(summary).toContain('asset-1');
    expect(summary).not.toContain('C:/assets');
  });
});
