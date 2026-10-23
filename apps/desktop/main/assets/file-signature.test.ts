import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectMagic, readMagic } from './file-signature';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WAV = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);
const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]);
const MP3_FRAME = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function ftyp(brand: string): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write(brand, 8, 'ascii');
  return buffer;
}

describe('detectMagic', () => {
  it('detects supported signatures', () => {
    expect(detectMagic(JPEG)).toEqual({ container: 'jpeg', kind: 'image' });
    expect(detectMagic(PNG)).toEqual({ container: 'png', kind: 'image' });
    expect(detectMagic(WAV)).toEqual({ container: 'wav', kind: 'audio' });
    expect(detectMagic(MP3_ID3)).toEqual({ container: 'mp3', kind: 'audio' });
    expect(detectMagic(MP3_FRAME)).toEqual({ container: 'mp3', kind: 'audio' });
    expect(detectMagic(ftyp('isom'))).toEqual({
      brand: 'isom',
      container: 'mp4',
      kind: 'video',
    });
    expect(detectMagic(ftyp('qt  '))).toEqual({
      brand: 'qt  ',
      container: 'mov',
      kind: 'video',
    });
    expect(detectMagic(ftyp('M4A '))).toEqual({
      brand: 'M4A ',
      container: 'm4a',
      kind: 'audio',
    });
    expect(detectMagic(ftyp('heic'))).toEqual({
      brand: 'heic',
      container: 'heic',
      kind: 'image',
    });
  });

  it('returns null for unknown or too-short data', () => {
    expect(detectMagic(Buffer.from('hello world!!'))).toBeNull();
    expect(detectMagic(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectMagic(Buffer.alloc(0))).toBeNull();
  });
});

describe('readMagic', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'miaoma-signature-'));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it('reads only the header of a large file', async () => {
    const filePath = path.join(directory, 'large.mp4');
    const content = Buffer.concat([ftyp('isom'), Buffer.alloc(1024 * 1024)]);
    writeFileSync(filePath, content);

    const result = await readMagic(filePath, content.length);

    expect(result.status).toBe('ok');
    expect(result.bytesRead).toBeLessThanOrEqual(64);
    expect(result.detection).toMatchObject({ container: 'mp4', kind: 'video' });
  });

  it('reports empty and too-short files', async () => {
    const emptyPath = path.join(directory, 'empty.jpg');
    writeFileSync(emptyPath, Buffer.alloc(0));
    expect(await readMagic(emptyPath, 0)).toMatchObject({
      detection: null,
      status: 'empty',
    });

    const shortPath = path.join(directory, 'short.jpg');
    writeFileSync(shortPath, Buffer.from([0xff, 0xd8, 0xff]));
    expect(await readMagic(shortPath, 3)).toMatchObject({
      detection: null,
      status: 'too-short',
    });
  });

  it('reports unreadable paths without leaking raw errors', async () => {
    const result = await readMagic(path.join(directory, 'missing.mp4'), 100);

    expect(result.status).toBe('unreadable');
    expect(result.errorCode).toBe('ENOENT');
    expect(result.detection).toBeNull();
  });
});
