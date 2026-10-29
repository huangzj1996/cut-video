import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StoredProject } from '@miaoma/video-project';
import {
  createPendingMusicAssetRegistry,
  isPathInsideDirectory,
  normalizePendingMusicAsset,
  withPendingMusicAssets,
} from './pending-assets';

const ROOT = path.join('D:', 'install', 'resources', 'assets', 'song');
const SONG = path.join(ROOT, 'Eutopia.m4a');

function projectWithMusic(paths: string[]): StoredProject {
  return {
    assets: {
      music: paths.map((filePath, index) => ({
        durationMs: 10_000,
        id: `saved-${index}`,
        path: filePath,
      })),
      subtitles: [],
      thumbnails: [],
      videos: [],
      voices: [],
    },
  } as unknown as StoredProject;
}

describe('isPathInsideDirectory', () => {
  it('accepts a file inside the library directory', () => {
    expect(isPathInsideDirectory(ROOT, SONG)).toBe(true);
  });

  it('rejects relative paths and paths outside the library directory', () => {
    expect(isPathInsideDirectory(ROOT, 'Eutopia.m4a')).toBe(false);
    expect(isPathInsideDirectory(ROOT, path.join(ROOT, '..', 'secret.m4a'))).toBe(false);
    expect(isPathInsideDirectory(ROOT, path.join('D:', 'Windows', 'win.ini'))).toBe(false);
    expect(isPathInsideDirectory(ROOT, ROOT)).toBe(false);
  });
});

describe('normalizePendingMusicAsset', () => {
  it('accepts a library track with a uuid-like asset id', () => {
    expect(
      normalizePendingMusicAsset({
        assetId: 'music-0b0f6c62-2f4b-4a7b-9c3d-1f2e3d4c5b6a',
        filePath: SONG,
        projectId: 'project-1',
        root: ROOT,
      }),
    ).toEqual({
      assetId: 'music-0b0f6c62-2f4b-4a7b-9c3d-1f2e3d4c5b6a',
      path: SONG,
    });
  });

  it('rejects invalid ids and paths outside the library', () => {
    const valid = {
      assetId: 'music-1',
      filePath: SONG,
      projectId: 'project-1',
      root: ROOT,
    };

    expect(normalizePendingMusicAsset({ ...valid, projectId: '../project' })).toBeNull();
    expect(normalizePendingMusicAsset({ ...valid, assetId: '../asset' })).toBeNull();
    expect(
      normalizePendingMusicAsset({ ...valid, filePath: path.join('D:', 'other.mp3') }),
    ).toBeNull();
  });
});

describe('createPendingMusicAssetRegistry', () => {
  it('registers per project and prunes after save', () => {
    const registry = createPendingMusicAssetRegistry();
    const asset = { assetId: 'music-1', path: SONG };

    registry.register('project-1', asset);

    expect(registry.list('project-1')).toEqual([asset]);
    expect(registry.list('project-2')).toEqual([]);

    registry.prune('project-1', ['music-1']);

    expect(registry.list('project-1')).toEqual([]);
  });
});

describe('withPendingMusicAssets', () => {
  it('appends pending assets that are not in the saved project yet', () => {
    const project = projectWithMusic([path.join(ROOT, 'saved.m4a')]);
    const pending = [
      { assetId: 'music-new', path: SONG },
      { assetId: 'saved-0', path: path.join(ROOT, 'saved.m4a') },
    ];

    const merged = withPendingMusicAssets(project, pending);

    expect(merged.assets.music.map((asset) => asset.id)).toEqual(['saved-0', 'music-new']);
    expect(merged.assets.music[1]).toMatchObject({ path: SONG });
  });

  it('returns the original project when there is nothing to merge', () => {
    const project = projectWithMusic([path.join(ROOT, 'saved.m4a')]);

    expect(withPendingMusicAssets(project, [])).toBe(project);
    expect(
      withPendingMusicAssets(project, [{ assetId: 'saved-0', path: path.join(ROOT, 'saved.m4a') }]),
    ).toBe(project);
  });
});
