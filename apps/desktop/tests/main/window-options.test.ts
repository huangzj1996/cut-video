import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from '../../src/main/window-options';

describe('main window options', () => {
  it('keeps native controls and isolates the renderer on Windows', () => {
    const options = createMainWindowOptions('win32', 'C:\\app\\preload.js');

    expect(options.titleBarStyle).toBe('hidden');
    expect(options.titleBarOverlay).toEqual({
      color: '#111318',
      symbolColor: '#f1f5f9',
    });
    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  it('uses the native title bar on other platforms', () => {
    const options = createMainWindowOptions('darwin', '/app/preload.js');

    expect(options.titleBarStyle).toBeUndefined();
    expect(options.titleBarOverlay).toBeUndefined();
  });
});
