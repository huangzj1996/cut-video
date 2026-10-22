import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '../shared/ipc-contract';

const SETTINGS_FILE = 'settings.json';

export function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function getDefaultProjectDirectory(): string {
  const fromEnv = process.env.MIAOMA_PROJECT_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  return path.join(app.getPath('documents'), '妙剪');
}

function createFallbackSettings(): AppSettings {
  return {
    defaultProjectDirectory: getDefaultProjectDirectory(),
  };
}

export function saveSettings(settings: AppSettings): void {
  const filePath = getSettingsFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

  // 首版只保证默认目录存在；完整设置 UI 与原子写入在 T04 实现。
  mkdirSync(settings.defaultProjectDirectory, { recursive: true });
}

export function loadSettings(): AppSettings {
  const envDirectory = process.env.MIAOMA_PROJECT_DIR?.trim();
  if (envDirectory) {
    mkdirSync(envDirectory, { recursive: true });
    return { defaultProjectDirectory: envDirectory };
  }

  const filePath = getSettingsFilePath();

  if (!existsSync(filePath)) {
    const settings = createFallbackSettings();
    saveSettings(settings);
    return settings;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<AppSettings>;
    const directory =
      typeof parsed.defaultProjectDirectory === 'string' &&
      parsed.defaultProjectDirectory.trim().length > 0
        ? parsed.defaultProjectDirectory
        : getDefaultProjectDirectory();

    return { defaultProjectDirectory: directory };
  } catch {
    const settings = createFallbackSettings();
    saveSettings(settings);
    return settings;
  }
}
