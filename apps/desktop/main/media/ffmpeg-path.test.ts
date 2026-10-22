import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBinaryFileName, resolveMediaBinary } from './ffmpeg-path';

describe('getBinaryFileName', () => {
  it('adds .exe on Windows', () => {
    expect(getBinaryFileName('ffmpeg', 'win32')).toBe('ffmpeg.exe');
    expect(getBinaryFileName('ffprobe', 'win32')).toBe('ffprobe.exe');
  });

  it('uses the bare name on non-Windows platforms', () => {
    expect(getBinaryFileName('ffmpeg', 'darwin')).toBe('ffmpeg');
    expect(getBinaryFileName('ffprobe', 'linux')).toBe('ffprobe');
  });
});

describe('resolveMediaBinary', () => {
  const base = {
    name: 'ffmpeg' as const,
    isPackaged: false,
    appPath: path.join('C:', 'app'),
    resourcesPath: path.join('C:', 'resources'),
    platform: 'win32' as const,
    env: {} as NodeJS.ProcessEnv,
  };

  it('prefers an explicit environment variable', () => {
    const explicit = path.join('D:', 'tools', 'ffmpeg.exe');
    expect(
      resolveMediaBinary({
        ...base,
        env: { MIAOMA_FFMPEG_PATH: explicit },
        existsSync: () => false,
      }),
    ).toBe(explicit);
  });

  it('uses the packaged resources directory when the binary exists', () => {
    const expected = path.join('C:', 'resources', 'ffmpeg', 'ffmpeg.exe');
    const existsSync = (candidate: string) => candidate === expected;

    expect(
      resolveMediaBinary({
        ...base,
        isPackaged: true,
        existsSync,
      }),
    ).toBe(expected);
  });

  it('uses the development resources directory when the binary exists', () => {
    const expected = path.join('C:', 'app', 'resources', 'ffmpeg', 'ffmpeg.exe');
    const existsSync = (candidate: string) => candidate === expected;

    expect(resolveMediaBinary({ ...base, existsSync })).toBe(expected);
  });

  it('falls back to the command name so PATH resolution can handle it', () => {
    expect(resolveMediaBinary({ ...base, existsSync: () => false })).toBe('ffmpeg');
  });

  it('resolves ffprobe independently', () => {
    const expected = path.join('C:', 'resources', 'ffmpeg', 'ffprobe.exe');
    expect(
      resolveMediaBinary({
        ...base,
        name: 'ffprobe',
        isPackaged: true,
        existsSync: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });
});
