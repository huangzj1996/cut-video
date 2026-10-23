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
import { buildAssetSelectionManifest, prepareProjectAssets } from './assets/project-assets';
import { probeVideo } from './assets/video-probe';
import { IpcError, toIpcErrorPayload } from './ipc-error';
import { resolveMediaBinary } from './media/ffmpeg-path';
import { ProjectStore } from './projects/project-store';
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

function resolveFfprobeExecutable(): string {
  return resolveMediaBinary({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    name: 'ffprobe',
  });
}

function getProjectStore(): ProjectStore {
  try {
    return new ProjectStore(loadSettings().defaultProjectDirectory);
  } catch {
    throw new IpcError('SETTINGS_READ_FAILED', '读取应用设置失败。', true);
  }
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

  handle(IPC_CHANNELS.project.list, () => getProjectStore().list());
  handle(IPC_CHANNELS.project.get, (projectId) => getProjectStore().get(projectId));
  handle(IPC_CHANNELS.project.update, (input) => getProjectStore().update(input));
  handle(IPC_CHANNELS.project.delete, (projectId) => getProjectStore().delete(projectId));

  handle(IPC_CHANNELS.project.create, async (input) => {
    const assetPath = (input as { assetPath?: unknown } | undefined)?.assetPath;

    if (assetPath !== undefined && typeof assetPath !== 'string') {
      throw new IpcError('ASSET_INVALID_ARGUMENT', '素材路径无效。');
    }

    const trimmedAssetPath = typeof assetPath === 'string' ? assetPath.trim() : '';
    let prepared: Awaited<ReturnType<typeof prepareProjectAssets>> | undefined;

    if (trimmedAssetPath) {
      const ffprobePath = resolveFfprobeExecutable();

      if (!isBinaryAvailable(ffprobePath)) {
        throw new IpcError('ASSET_PROBE_UNAVAILABLE', '未找到 ffprobe，暂时无法解析视频元数据。');
      }

      prepared = await prepareProjectAssets(trimmedAssetPath, (candidate) =>
        probeVideo(ffprobePath, candidate.path),
      );
    }

    const projectStore = getProjectStore();
    const project = projectStore.create(input, prepared ? { assets: prepared.assets } : undefined);

    if (prepared) {
      try {
        projectStore.writeAssetManifest(
          project.project.projectId,
          buildAssetSelectionManifest(project.project.projectId, prepared),
        );
      } catch (error) {
        try {
          projectStore.delete(project.project.projectId);
        } catch {
          // 回滚失败时保留原始错误。
        }
        throw error;
      }
    }

    return project;
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
