import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { removeExportTempArtifacts, type ExportTempArtifacts } from './artifacts';

export type { ExportTempArtifacts } from './artifacts';

/**
 * 导出临时产物的登记目录。
 *
 * 两段式导出的 .partial 成品、预混音轨、ASS 与字体目录必须和目标文件同目录
 * （rename 不跨盘、滤镜路径要求相对 ASCII），因此它们散落在用户选择的导出目录里。
 * 正常失败/取消由任务自己清理；进程崩溃或应用被杀时没人清理，所以每次导出在
 * 系统临时目录下写一个很小的登记目录，记录本次导出的产物路径与所有者进程。
 * 应用启动时按“所有者已退出或已过期”回收这些登记目录与它们登记的产物。
 */
export const EXPORT_WORKSPACE_ROOT_NAME = 'miaoma-export-workspaces';
export const EXPORT_WORKSPACE_MANIFEST_NAME = 'workspace.json';
/** 兜底过期时间：进程号可能被复用，超过这个年龄一律回收。 */
export const DEFAULT_STALE_EXPORT_WORKSPACE_MS = 24 * 60 * 60 * 1000;
const WORKSPACE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ExportTempWorkspace {
  directory: string;
  /** 删除登记的临时产物与工作目录；可重复调用，失败不抛出。 */
  dispose(): void;
}

export interface CreateExportTempWorkspaceInput {
  artifacts: ExportTempArtifacts;
  createdAt: number;
  /** 已经解析到 .../<EXPORT_WORKSPACE_ROOT_NAME> 的工作区根目录。 */
  root: string;
  /** 每次导出唯一、只含 ASCII 的标识（用 runId）。 */
  token: string;
}

interface ExportWorkspaceManifest {
  artifacts: ExportTempArtifacts;
  createdAt: number;
  pid: number;
}

function removeDirectoryQuietly(directory: string): void {
  try {
    rmSync(directory, { force: true, maxRetries: 3, recursive: true });
  } catch {
    // 同上。
  }
}

export function resolveExportWorkspaceRoot(tempRoot: string): string {
  return path.join(tempRoot, EXPORT_WORKSPACE_ROOT_NAME);
}

/**
 * 建立一次导出的登记目录并写入清单。
 * 目录名就是 runId；清单记录产物路径、创建时间与所有者 pid。
 */
export function createExportTempWorkspace(
  input: CreateExportTempWorkspaceInput,
): ExportTempWorkspace {
  if (!WORKSPACE_TOKEN_PATTERN.test(input.token)) {
    throw new Error('无效的导出临时工作区标识。');
  }

  const directory = path.join(input.root, input.token);
  const manifest: ExportWorkspaceManifest = {
    artifacts: input.artifacts,
    createdAt: input.createdAt,
    pid: process.pid,
  };

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, EXPORT_WORKSPACE_MANIFEST_NAME),
    JSON.stringify(manifest),
    'utf8',
  );

  let disposed = false;

  return {
    directory,
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      removeExportTempArtifacts(input.artifacts);
      removeDirectoryQuietly(directory);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** 校验从磁盘读到的清单；损坏或不完整时返回 null，不做任何删除。 */
function parseManifest(raw: string): ExportWorkspaceManifest | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) {
    return null;
  }

  const createdAt = parsed.createdAt;
  const artifacts = parsed.artifacts;

  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || !isRecord(artifacts)) {
    return null;
  }

  if (typeof artifacts.partialPath !== 'string' || typeof artifacts.premixPath !== 'string') {
    return null;
  }

  if (!isStringOrUndefined(artifacts.assPath) || !isStringOrUndefined(artifacts.fontsDirPath)) {
    return null;
  }

  return {
    artifacts: {
      partialPath: artifacts.partialPath,
      premixPath: artifacts.premixPath,
      ...(artifacts.assPath !== undefined ? { assPath: artifacts.assPath } : {}),
      ...(artifacts.fontsDirPath !== undefined ? { fontsDirPath: artifacts.fontsDirPath } : {}),
    },
    createdAt,
    pid: parsed.pid,
  };
}

function readWorkspaceManifest(directory: string): ExportWorkspaceManifest | null {
  try {
    return parseManifest(
      readFileSync(path.join(directory, EXPORT_WORKSPACE_MANIFEST_NAME), 'utf8'),
    );
  } catch {
    // 清单不存在或读不到时只能按目录年龄兜底回收。
    return null;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 表示进程存在但无权发信号，仍然算活着。
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface CleanupStaleExportWorkspacesInput {
  /** 已经解析到 .../<EXPORT_WORKSPACE_ROOT_NAME> 的工作区根目录。 */
  root: string;
  now: number;
  maxAgeMs?: number;
  /** 测试接缝：默认用 process.kill(pid, 0)。 */
  isProcessAlive?: (pid: number) => boolean;
}

function directoryAgeMs(directory: string, now: number): number | null {
  try {
    return now - statSync(directory).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 应用启动时清理过期的导出临时工作区（以及它们登记的临时产物）。
 *
 * 只有“所有者进程已退出”或“超过兜底年龄”才回收；另一个仍在渲染的应用实例
 * 的工作区保持不动。清单损坏的目录只有在目录本身足够旧时才回收。
 */
export function cleanupStaleExportWorkspaces(input: CleanupStaleExportWorkspacesInput): number {
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_STALE_EXPORT_WORKSPACE_MS;
  const isProcessAlive = input.isProcessAlive ?? defaultIsProcessAlive;
  let removed = 0;
  let entries: string[];

  try {
    entries = readdirSync(input.root);
  } catch {
    // 没有临时根目录说明从没导出过。
    return 0;
  }

  for (const entry of entries) {
    const directory = path.join(input.root, entry);
    const ageMs = directoryAgeMs(directory, input.now);

    if (ageMs === null) {
      continue;
    }

    const manifest = readWorkspaceManifest(directory);

    if (manifest === null) {
      if (ageMs > maxAgeMs) {
        removeDirectoryQuietly(directory);
        removed += 1;
      }

      continue;
    }

    const staleByAge = input.now - manifest.createdAt > maxAgeMs;
    const ownerGone = !isProcessAlive(manifest.pid);

    if (staleByAge || ownerGone) {
      removeExportTempArtifacts(manifest.artifacts);
      removeDirectoryQuietly(directory);
      removed += 1;
    }
  }

  return removed;
}
