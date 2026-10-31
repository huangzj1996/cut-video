import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPORT_FONT_FILE_NAME, resolveExportFonts } from './fonts';

const FONT_PATH = path.join('C:/app', 'resources', 'fonts', EXPORT_FONT_FILE_NAME);

describe('export fonts', () => {
  it('resolves the bundled font from resources/fonts in development', () => {
    const fonts = resolveExportFonts({
      appPath: 'C:/app',
      existsSync: (candidate) => candidate === FONT_PATH,
      isPackaged: false,
      resourcesPath: 'C:/app/resources',
    });

    expect(fonts).toEqual({
      directory: path.join('C:/app', 'resources', 'fonts'),
      files: [FONT_PATH],
    });
  });

  it('resolves the packaged extraResource font directory', () => {
    const fonts = resolveExportFonts({
      appPath: 'C:/app/asar',
      existsSync: () => true,
      isPackaged: true,
      resourcesPath: 'C:/app/resources',
    });

    expect(fonts?.directory).toBe(path.join('C:/app/resources', 'fonts'));
    expect(fonts?.files).toEqual([path.join('C:/app/resources', 'fonts', EXPORT_FONT_FILE_NAME)]);
  });

  it('returns null when the bundled font is missing', () => {
    expect(
      resolveExportFonts({
        appPath: 'C:/app',
        existsSync: () => false,
        isPackaged: false,
        resourcesPath: 'C:/app/resources',
      }),
    ).toBeNull();
  });
});
