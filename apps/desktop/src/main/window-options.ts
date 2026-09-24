import type { BrowserWindowConstructorOptions } from 'electron';
import { APP_NAME } from '../shared/app-info';

export function createMainWindowOptions(
  platform: NodeJS.Platform,
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    ...(platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#111318',
            symbolColor: '#f1f5f9',
          },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
