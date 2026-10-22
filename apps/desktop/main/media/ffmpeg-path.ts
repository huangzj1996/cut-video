import { existsSync as fsExistsSync } from 'node:fs';
import path from 'node:path';

export type MediaBinaryName = 'ffmpeg' | 'ffprobe';

export interface ResolveMediaBinaryOptions {
  name: MediaBinaryName;
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (candidate: string) => boolean;
}

const ENV_KEYS: Record<MediaBinaryName, string> = {
  ffmpeg: 'MIAOMA_FFMPEG_PATH',
  ffprobe: 'MIAOMA_FFPROBE_PATH',
};

export function getBinaryFileName(
  name: MediaBinaryName,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? `${name}.exe` : name;
}

/**
 * 解析 FFmpeg/ffprobe 路径，优先级：
 * 1. 显式环境变量；
 * 2. 打包态 resources/ffmpeg；
 * 3. 开发态 apps/desktop/resources/ffmpeg；
 * 4. 系统 PATH（返回裸命令名）。
 *
 * 纯函数，便于在 Node 测试中注入 platform/env/existsSync。
 */
export function resolveMediaBinary(options: ResolveMediaBinaryOptions): string {
  const {
    name,
    isPackaged,
    appPath,
    resourcesPath,
    platform = process.platform,
    env = process.env,
    existsSync = fsExistsSync,
  } = options;

  const explicit = env[ENV_KEYS[name]];
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  const fileName = getBinaryFileName(name, platform);
  const candidates = isPackaged
    ? [path.join(resourcesPath, 'ffmpeg', fileName)]
    : [path.join(appPath, 'resources', 'ffmpeg', fileName)];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return name;
}
