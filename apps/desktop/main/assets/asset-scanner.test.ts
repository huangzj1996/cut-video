import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanAssetRoots } from './asset-scanner';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WAV = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]);

function ftyp(brand: string): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write(brand, 8, 'ascii');
  return buffer;
}

const MP4 = ftyp('isom');
const MOV = ftyp('qt  ');

let directory: string;
let rootA: string;
let rootB: string;

function writeFixture(base: string, relativePath: string, content: Buffer): string {
  const filePath = path.join(base, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

function issueCodes(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((issue) => issue.code);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'miaoma-scanner-'));
  rootA = path.join(directory, '素材 A');
  rootB = path.join(directory, 'root-b');
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('scanAssetRoots', () => {
  it('scans multiple roots recursively and filters unsupported extensions', async () => {
    const mp4Path = writeFixture(rootA, 'clip.mp4', MP4);
    const jpgPath = writeFixture(rootA, path.join('nested', 'photo.JPG'), JPEG);
    const mp3Path = writeFixture(rootB, 'music.mp3', MP3);
    writeFixture(rootB, 'notes.txt', Buffer.from('hello world'));

    const result = await scanAssetRoots({ roots: [rootA, rootB] });
    const byPath = new Map(result.candidates.map((candidate) => [candidate.path, candidate]));

    expect(result.cancelled).toBe(false);
    expect(result.candidates).toHaveLength(3);
    expect(byPath.get(mp4Path)?.kind).toBe('video');
    expect(byPath.get(jpgPath)?.kind).toBe('image');
    expect(byPath.get(mp3Path)?.kind).toBe('audio');
    expect(result.stats.filesSeen).toBe(4);
    expect(result.stats.extensionSkipped).toBe(1);
    expect(result.stats.rootsScanned).toBe(2);
  });

  it('deduplicates duplicate and nested roots', async () => {
    writeFixture(rootA, 'clip.mp4', MP4);
    writeFixture(rootA, path.join('nested', 'photo.png'), PNG);

    const result = await scanAssetRoots({
      roots: [rootA, path.join(rootA, 'nested'), rootA],
    });

    expect(result.candidates).toHaveLength(2);
    expect(issueCodes(result)).toEqual(expect.arrayContaining(['ROOT_DUPLICATE', 'ROOT_NESTED']));
    expect(result.stats.duplicates).toBe(0);
  });

  it('rejects extension/magic mismatches in strict mode', async () => {
    const filePath = writeFixture(rootA, 'actually-png.jpg', PNG);

    const result = await scanAssetRoots({ roots: [rootA] });
    const candidate = result.candidates.find((item) => item.path === filePath);

    expect(candidate?.status).toBe('rejected');
    expect(candidate?.issues.map((issue) => issue.code)).toContain('EXTENSION_MAGIC_MISMATCH');
    expect(candidate?.detected).toMatchObject({
      container: 'png',
      extensionKind: 'image',
      magicKind: 'image',
    });
  });

  it('accepts mismatches with warnings in magic-preferred mode', async () => {
    const filePath = writeFixture(rootA, 'actually-png.jpg', PNG);

    const result = await scanAssetRoots({
      filterMode: 'magic-preferred',
      roots: [rootA],
    });
    const candidate = result.candidates.find((item) => item.path === filePath);

    expect(candidate?.status).toBe('ready');
    expect(candidate?.issues.map((issue) => issue.code)).toContain('EXTENSION_MAGIC_MISMATCH');
  });

  it('can include unknown extensions in magic-preferred mode', async () => {
    const filePath = writeFixture(rootA, 'no-extension', PNG);

    const strict = await scanAssetRoots({ roots: [rootA] });
    expect(strict.candidates).toHaveLength(0);
    expect(strict.stats.extensionSkipped).toBe(1);

    const loose = await scanAssetRoots({
      filterMode: 'magic-preferred',
      roots: [rootA],
    });
    expect(loose.candidates).toHaveLength(1);
    expect(loose.candidates[0]?.path).toBe(filePath);
    expect(loose.candidates[0]?.kind).toBe('image');
    expect(loose.candidates[0]?.issues.map((issue) => issue.code)).toContain(
      'EXTENSION_NOT_SUPPORTED',
    );
  });

  it('skips unknown extensions without magic in magic-preferred mode', async () => {
    writeFixture(rootA, 'notes.bin', Buffer.from('plain text content'));

    const result = await scanAssetRoots({
      filterMode: 'magic-preferred',
      roots: [rootA],
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.stats.extensionSkipped).toBe(1);
  });

  it('records empty, short, and unknown files', async () => {
    writeFixture(rootA, 'empty.mp4', Buffer.alloc(0));
    writeFixture(rootA, 'short.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    writeFixture(rootA, 'unknown.png', Buffer.from('this is not a png file'));

    const result = await scanAssetRoots({ roots: [rootA] });
    const byName = new Map(result.candidates.map((item) => [item.fileName, item]));

    expect(byName.get('empty.mp4')?.issues.map((issue) => issue.code)).toContain('EMPTY_FILE');
    expect(byName.get('short.jpg')?.issues.map((issue) => issue.code)).toContain('FILE_TOO_SHORT');
    expect(byName.get('unknown.png')?.issues.map((issue) => issue.code)).toContain(
      'MAGIC_NOT_DETECTED',
    );
    expect(result.stats.rejected).toBe(3);
  });

  it('handles file roots, missing roots, and drive roots', async () => {
    const filePath = writeFixture(rootA, 'clip.mp4', MP4);

    const result = await scanAssetRoots({
      roots: [filePath, path.join(directory, 'missing'), path.parse(directory).root],
    });

    expect(result.candidates.map((item) => item.path)).toContain(filePath);
    expect(issueCodes(result)).toEqual(expect.arrayContaining(['ROOT_NOT_FOUND', 'ROOT_IS_DRIVE']));
  });

  it('enforces depth and entry limits', async () => {
    writeFixture(rootA, 'root.mp4', MP4);
    writeFixture(rootA, path.join('one', 'two', 'deep.mp4'), MP4);

    const depthResult = await scanAssetRoots({ maxDepth: 1, roots: [rootA] });
    expect(depthResult.candidates.map((item) => item.fileName)).toEqual(['root.mp4']);
    expect(issueCodes(depthResult)).toContain('SCAN_LIMIT_REACHED');

    const entryResult = await scanAssetRoots({ maxEntries: 1, roots: [rootA] });
    expect(entryResult.candidates).toHaveLength(1);
    expect(issueCodes(entryResult)).toContain('SCAN_LIMIT_REACHED');
  });

  it('returns partial results when cancelled', async () => {
    writeFixture(rootA, 'clip.mp4', MP4);
    const controller = new AbortController();
    controller.abort();

    const result = await scanAssetRoots({
      roots: [rootA],
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.candidates).toHaveLength(0);
    expect(issueCodes(result)).toContain('SCAN_CANCELLED');
  });

  it('skips ignored directories and junctions', async () => {
    writeFixture(rootA, 'keep.mp4', MP4);
    writeFixture(rootA, path.join('node_modules', 'pkg', 'skip.mp4'), MP4);
    writeFixture(rootA, path.join('target', 'linked.mp4'), MP4);

    let junctionCreated = false;

    try {
      symlinkSync(path.join(rootA, 'target'), path.join(rootA, 'link'), 'junction');
      junctionCreated = true;
    } catch {
      // 某些 Windows 环境不允许创建 junction，跳过该断言。
    }

    const result = await scanAssetRoots({ roots: [rootA] });
    const fileNames = result.candidates.map((item) => item.fileName);

    expect(fileNames).toContain('keep.mp4');
    expect(fileNames).not.toContain('skip.mp4');
    expect(result.stats.ignoredDirectories).toBeGreaterThan(0);

    if (junctionCreated) {
      expect(result.stats.symlinksSkipped).toBeGreaterThan(0);
      expect(issueCodes(result)).toContain('SYMLINKS_SKIPPED');
    }
  });

  it('emits progress and handles Chinese and space characters in paths', async () => {
    writeFixture(rootA, path.join('子目录', '城市 夜景.mp4'), MOV);
    let progressCalls = 0;

    const result = await scanAssetRoots({
      onProgress: () => {
        progressCalls += 1;
      },
      roots: [rootA],
    });

    expect(result.candidates[0]?.fileName).toBe('城市 夜景.mp4');
    expect(result.candidates[0]?.detected.container).toBe('mov');
    expect(progressCalls).toBeGreaterThan(0);
  });

  it('rejects relative and empty roots', async () => {
    const result = await scanAssetRoots({ roots: ['relative/path', ''] });

    expect(result.candidates).toHaveLength(0);
    expect(issueCodes(result)).toEqual(
      expect.arrayContaining(['ROOT_NOT_ABSOLUTE', 'ROOT_INVALID']),
    );
  });

  it('sorts candidates by path key', async () => {
    writeFixture(rootA, 'b.mp4', MP4);
    writeFixture(rootA, 'a.mp4', MP4);

    const result = await scanAssetRoots({ roots: [rootA] });

    expect(result.candidates.map((item) => item.fileName)).toEqual(['a.mp4', 'b.mp4']);
  });

  it('accepts wav and audio containers', async () => {
    writeFixture(rootA, 'voice.wav', WAV);

    const result = await scanAssetRoots({ roots: [rootA] });

    expect(result.candidates[0]?.kind).toBe('audio');
    expect(result.candidates[0]?.detected.container).toBe('wav');
  });
});
