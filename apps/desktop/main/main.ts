import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import started from 'electron-squirrel-startup';
import {
  IPC_CHANNELS,
  type AppInfo,
  type AppSettings,
  type IpcChannel,
  type IpcHandler,
  type IpcParams,
  type IpcResponse,
  type IpcResult,
  type MediaInfo,
} from '../shared/ipc-contract';
import { IpcError, toIpcErrorPayload } from './ipc-error';
import { resolveMediaBinary } from './media/ffmpeg-path';
import { loadSettings } from './settings';

if (started) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.miaoma.magicut');
}

function isBinaryAvailable(binaryPath: string): boolean {
  if (path.isAbsolute(binaryPath)) {
    return existsSync(binaryPath);
  }

  const result = spawnSync(binaryPath, ['-version'], {
    windowsHide: true,
    stdio: 'ignore',
  });

  return result.status === 0;
}

function buildMediaInfo(): MediaInfo {
  const common = {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  } as const;

  const ffmpegPath = resolveMediaBinary({ ...common, name: 'ffmpeg' });
  const ffprobePath = resolveMediaBinary({ ...common, name: 'ffprobe' });

  return {
    ffmpegPath,
    ffprobePath,
    ffmpegExists: isBinaryAvailable(ffmpegPath),
    ffprobeExists: isBinaryAvailable(ffprobePath),
  };
}

function handle<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(
    channel,
    async (_event, ...params: unknown[]): Promise<IpcResponse<IpcResult<C>>> => {
      try {
        const data = await handler(...(params as IpcParams<C>));
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: toIpcErrorPayload(error) };
      }
    },
  );
}

function registerIpcHandlers(): void {
  handle(IPC_CHANNELS.app.ping, () => 'pong');

  handle(IPC_CHANNELS.app.getInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
      chrome: process.versions.chrome ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
    };
  });

  handle(IPC_CHANNELS.settings.get, (): AppSettings => {
    try {
      return loadSettings();
    } catch {
      throw new IpcError('SETTINGS_READ_FAILED', '读取应用设置失败。', true);
    }
  });

  handle(IPC_CHANNELS.media.getInfo, () => {
    try {
      return buildMediaInfo();
    } catch {
      throw new IpcError('MEDIA_INFO_FAILED', '媒体工具检测失败。', true);
    }
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: '妙剪 Magicut',
    backgroundColor: '#0D1015',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.MIAOMA_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
