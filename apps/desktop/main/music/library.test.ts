import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMusicLibraryLoader,
  loadMusicLibrary,
  parseMusicManifest,
  resolveMusicLibraryRoot,
  type MusicLibraryDeps,
} from './library';

const ROOT = path.join('C:', 'app', 'resources', 'assets', 'song');

function manifest(entries: unknown[]): string {
  return JSON.stringify({ items: entries, sort: 'created_at_ascending' });
}

interface FixtureOptions {
  files?: string[];
  manifest?: string;
  probes?: Record<string, { durationMs: number; ok: true } | { message: string; ok: false }>;
}

function createDeps(options: FixtureOptions = {}): MusicLibraryDeps {
  const files = new Set(options.files ?? []);
  const probes = options.probes ?? {};

  return {
    readManifest: (filePath) => {
      if (filePath !== path.join(ROOT, 'song.json')) {
        throw new Error('missing manifest');
      }

      return options.manifest ?? manifest([]);
    },
    probeDuration: (filePath) => {
      const name = path.basename(filePath);

      return probes[name] ?? { durationMs: 10_000, ok: true };
    },
    root: ROOT,
    stat: (filePath) => (files.has(path.basename(filePath)) ? { isFile: true } : null),
  };
}

describe('resolveMusicLibraryRoot', () => {
  it('reads from the app resources directory in development', () => {
    expect(
      resolveMusicLibraryRoot({
        appPath: path.join('D:', 'repo', 'apps', 'desktop'),
        isPackaged: false,
        resourcesPath: path.join('D:', 'resources'),
      }),
    ).toBe(path.join('D:', 'repo', 'apps', 'desktop', 'resources', 'assets', 'song'));
  });

  it('reads from the packaged resources directory', () => {
    expect(
      resolveMusicLibraryRoot({
        appPath: path.join('D:', 'app.asar'),
        isPackaged: true,
        resourcesPath: path.join('D:', 'install', 'resources'),
      }),
    ).toBe(path.join('D:', 'install', 'resources', 'assets', 'song'));
  });
});

describe('parseMusicManifest', () => {
  it('keeps valid entries and skips malformed ones', () => {
    const entries = parseMusicManifest(
      manifest([
        { fileName: 'b.m4a', order: 2, title: 'B' },
        { order: 1 },
        'oops',
        { fileName: 'a.m4a', order: 1, scenes: ['社会题材', ' ', 3], title: '' },
      ]),
    );

    expect(entries?.map((entry) => entry.fileName)).toEqual(['a.m4a', 'b.m4a']);
    expect(entries?.[0]?.title).toBe('a.m4a');
    expect(entries?.[0]?.scenes).toEqual(['社会题材']);
  });

  it('rejects malformed manifest documents', () => {
    expect(parseMusicManifest('not json')).toBeNull();
    expect(parseMusicManifest('[]')).toBeNull();
    expect(parseMusicManifest('{"items":{}}')).toBeNull();
  });

  it('tolerates a UTF-8 BOM before the manifest JSON', () => {
    expect(parseMusicManifest(`\uFEFF${manifest([{ fileName: 'a.m4a', order: 1 }])}`)).toHaveLength(
      1,
    );
  });
});

describe('loadMusicLibrary', () => {
  it('sorts by order and returns duration from the probe', async () => {
    const result = await loadMusicLibrary(
      createDeps({
        files: ['第二首.m4a', 'first.mp3'],
        manifest: manifest([
          {
            fileName: '第二首.m4a',
            mood: '平静',
            order: 2,
            scenes: ['社会题材'],
            tempo: '偏慢',
            title: '第二首',
          },
          { fileName: 'first.mp3', order: 1, title: 'First' },
        ]),
        probes: {
          'first.mp3': { durationMs: 61_000, ok: true },
          '第二首.m4a': { durationMs: 121_456, ok: true },
        },
      }),
    );

    expect(result.status).toBe('ok');
    expect(result.items.map((item) => item.title)).toEqual(['First', '第二首']);
    expect(result.items[1]).toMatchObject({
      available: true,
      durationMs: 121_456,
      mood: '平静',
      path: path.join(ROOT, '第二首.m4a'),
      scenes: ['社会题材'],
      tempo: '偏慢',
    });
  });

  it('keeps the library usable when one file is missing or one probe fails', async () => {
    const result = await loadMusicLibrary(
      createDeps({
        files: ['broken.m4a', 'ok.m4a'],
        manifest: manifest([
          { fileName: 'missing.m4a', order: 1, title: '缺失' },
          { fileName: 'broken.m4a', order: 2, title: '坏文件' },
          { fileName: 'ok.m4a', order: 3, title: '正常' },
        ]),
        probes: {
          'broken.m4a': { message: '无法读取音频时长。', ok: false },
          'ok.m4a': { durationMs: 5_000, ok: true },
        },
      }),
    );

    expect(result.status).toBe('ok');
    expect(result.items.map((item) => item.available)).toEqual([false, false, true]);
    expect(result.items[0]?.unavailableReason).toBe('音频文件缺失。');
    expect(result.items[1]?.unavailableReason).toBe('无法读取音频时长。');
    expect(result.items[2]?.durationMs).toBe(5_000);
  });

  it('rejects file names that escape the library directory', async () => {
    const result = await loadMusicLibrary(
      createDeps({
        files: ['song.m4a'],
        manifest: manifest([{ fileName: path.join('..', '..', 'song.m4a'), order: 1 }]),
      }),
    );

    expect(result.items[0]).toMatchObject({
      available: false,
      unavailableReason: '文件名超出了音乐库目录。',
    });
  });

  it('reports an unavailable library when the manifest is missing or invalid', async () => {
    const missing = await loadMusicLibrary({
      ...createDeps(),
      readManifest: () => {
        throw new Error('ENOENT');
      },
    });
    const invalid = await loadMusicLibrary(createDeps({ manifest: '{"items":"nope"}' }));

    expect(missing).toMatchObject({ items: [], status: 'unavailable' });
    expect(invalid).toMatchObject({ items: [], status: 'unavailable' });
    expect(missing.message).toContain('音乐库');
  });
});

describe('createMusicLibraryLoader', () => {
  it('retries an unavailable library instead of caching the failure', async () => {
    let manifestReads = 0;
    const base = createDeps();
    const loader = createMusicLibraryLoader({
      ...base,
      readManifest: () => {
        manifestReads += 1;
        throw new Error('ENOENT');
      },
    });

    const first = await loader.load();
    const second = await loader.load();

    expect(first.status).toBe('unavailable');
    expect(second.status).toBe('unavailable');
    expect(manifestReads).toBe(2);
  });

  it('does not re-probe after a successful load', async () => {
    let probes = 0;
    const base = createDeps({
      files: ['song.m4a'],
      manifest: manifest([{ fileName: 'song.m4a', order: 1, title: 'Song' }]),
    });
    const loader = createMusicLibraryLoader({
      ...base,
      probeDuration: (filePath) => {
        probes += 1;
        return base.probeDuration(filePath);
      },
    });

    await loader.load();
    await loader.load();

    expect(probes).toBe(1);
  });
});
