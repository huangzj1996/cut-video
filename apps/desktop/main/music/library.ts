import path from 'node:path';
import type { MusicLibraryResult, MusicLibraryTrack } from '../../shared/ipc-contract';

/**
 * 应用内置本地音乐库：读取应用资源目录里的 `song.json` 清单与音频文件，
 * 逐条 stat + ffprobe 精确时长，返回给面板渲染的结构化条目。
 *
 * 依赖全部可注入，便于在不放真实音频的机器/CI 上测试；任何失败都不抛异常，
 * 而是落成“库不可用”或单条不可用，避免拖垮编辑器。
 */

export const MUSIC_LIBRARY_MANIFEST = 'song.json';

export interface MusicLibraryRootOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

export function resolveMusicLibraryRoot(options: MusicLibraryRootOptions): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, 'assets', 'song')
    : path.join(options.appPath, 'resources', 'assets', 'song');
}

export type MusicDurationProbe = { durationMs: number; ok: true } | { message: string; ok: false };

export interface MusicLibraryDeps {
  readManifest(filePath: string): string | Promise<string>;
  probeDuration(filePath: string): MusicDurationProbe | Promise<MusicDurationProbe>;
  root: string;
  stat(filePath: string): { isFile: boolean } | null | Promise<{ isFile: boolean } | null>;
}

interface ManifestEntry {
  description?: string;
  durationLabel?: string;
  fileName: string;
  mood?: string;
  order: number;
  scenes: string[];
  tempo?: string;
  title: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function readScenes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((scene) => {
    const text = readText(scene);

    return text ? [text] : [];
  });
}

/**
 * 解析清单；结构不对（不是对象、没有 items 数组）返回 null。
 * 单条损坏（缺 fileName 等）只跳过该条，其余条目仍然可用。
 */
export function parseMusicManifest(contents: string): ManifestEntry[] | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    return null;
  }

  const entries: ManifestEntry[] = [];

  parsed.items.forEach((raw, index) => {
    if (!isRecord(raw)) {
      return;
    }

    const fileName = readText(raw.fileName);

    if (!fileName) {
      return;
    }

    const order =
      typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : index + 1;
    const description = readText(raw.description);
    const mood = readText(raw.mood);
    const tempo = readText(raw.tempo);
    const durationLabel = readText(raw.duration);

    entries.push({
      fileName,
      order,
      scenes: readScenes(raw.scenes),
      title: readText(raw.title) ?? fileName,
      ...(description !== undefined ? { description } : {}),
      ...(mood !== undefined ? { mood } : {}),
      ...(tempo !== undefined ? { tempo } : {}),
      ...(durationLabel !== undefined ? { durationLabel } : {}),
    });
  });

  return entries.sort(
    (left, right) => left.order - right.order || left.fileName.localeCompare(right.fileName),
  );
}

function unavailable(entry: ManifestEntry, filePath: string, reason: string): MusicLibraryTrack {
  return {
    available: false,
    durationMs: null,
    fileName: entry.fileName,
    path: filePath,
    scenes: entry.scenes,
    title: entry.title,
    unavailableReason: reason,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.mood !== undefined ? { mood: entry.mood } : {}),
    ...(entry.tempo !== undefined ? { tempo: entry.tempo } : {}),
  };
}

async function buildTrack(
  root: string,
  entry: ManifestEntry,
  deps: MusicLibraryDeps,
): Promise<MusicLibraryTrack> {
  const filePath = path.resolve(root, entry.fileName);
  const relative = path.relative(root, filePath);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return unavailable(entry, filePath, '文件名超出了音乐库目录。');
  }

  let stat: { isFile: boolean } | null;

  try {
    stat = await deps.stat(filePath);
  } catch {
    stat = null;
  }

  if (!stat || !stat.isFile) {
    return unavailable(entry, filePath, '音频文件缺失。');
  }

  let probe: MusicDurationProbe;

  try {
    probe = await deps.probeDuration(filePath);
  } catch {
    probe = { message: '无法读取音频时长。', ok: false };
  }

  if (!probe.ok) {
    return unavailable(entry, filePath, probe.message);
  }

  if (!Number.isSafeInteger(probe.durationMs) || probe.durationMs <= 0) {
    return unavailable(entry, filePath, '音频时长无效。');
  }

  return {
    available: true,
    durationMs: probe.durationMs,
    fileName: entry.fileName,
    path: filePath,
    scenes: entry.scenes,
    title: entry.title,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.mood !== undefined ? { mood: entry.mood } : {}),
    ...(entry.tempo !== undefined ? { tempo: entry.tempo } : {}),
  };
}

export async function loadMusicLibrary(deps: MusicLibraryDeps): Promise<MusicLibraryResult> {
  let contents: string;

  try {
    contents = await deps.readManifest(path.join(deps.root, MUSIC_LIBRARY_MANIFEST));
  } catch {
    return {
      items: [],
      message: '未找到本地音乐库或清单不可读。',
      status: 'unavailable',
    };
  }

  const entries = parseMusicManifest(contents);

  if (!entries) {
    return {
      items: [],
      message: '本地音乐库清单格式无效。',
      status: 'unavailable',
    };
  }

  const items = await Promise.all(entries.map((entry) => buildTrack(deps.root, entry, deps)));

  return { items, status: 'ok' };
}

/**
 * 进程内缓存：成功读取后不再重复 stat / ffprobe；库不可用时允许下次重试，
 * 便于开发机后放入素材后不重启应用。
 */
export function createMusicLibraryLoader(deps: MusicLibraryDeps): {
  load(force?: boolean): Promise<MusicLibraryResult>;
} {
  let cached: MusicLibraryResult | null = null;

  return {
    async load(force = false): Promise<MusicLibraryResult> {
      if (!force && cached?.status === 'ok') {
        return cached;
      }

      const result = await loadMusicLibrary(deps);

      if (result.status === 'ok') {
        cached = result;
      }

      return result;
    },
  };
}
