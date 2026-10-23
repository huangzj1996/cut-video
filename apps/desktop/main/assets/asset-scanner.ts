import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  getExtensionInfo,
  getFileExtension,
  type AssetContainer,
  type AssetKind,
} from './extension-registry';
import { readMagic } from './file-signature';
import { isPathInside, pathDepth, toPathKey } from './path-key';

export type ScanFilterMode = 'magic-preferred' | 'strict';
export type ScanCandidateStatus = 'changed' | 'ready' | 'rejected' | 'unreadable';

export interface ScanIssue {
  code: string;
  message: string;
  path?: string;
  retryable?: boolean;
  root?: string;
  severity: 'error' | 'warning';
}

export interface ScanDetected {
  brand?: string;
  container?: AssetContainer;
  extensionKind?: AssetKind;
  magicKind?: AssetKind;
}

export interface ScanCandidate {
  detected: ScanDetected;
  extension: string;
  fileName: string;
  issues: ScanIssue[];
  kind: AssetKind | null;
  mtimeMs: number;
  path: string;
  pathKey: string;
  root: string;
  sizeBytes: number;
  status: ScanCandidateStatus;
}

export interface ScanProgress {
  cancelled: boolean;
  currentDirectory?: string;
  currentRoot: string;
  directoriesVisited: number;
  extensionMatches: number;
  filesSeen: number;
  magicMatches: number;
  rejected: number;
}

export interface ScanStats {
  directoriesVisited: number;
  duplicates: number;
  elapsedMs: number;
  extensionMatches: number;
  extensionSkipped: number;
  filesSeen: number;
  ignoredDirectories: number;
  magicMatches: number;
  rejected: number;
  rootsScanned: number;
  symlinksSkipped: number;
}

export interface ScanOptions {
  filterMode?: ScanFilterMode;
  ignoreDirectories?: readonly string[];
  ignorePathKeys?: readonly string[];
  maxDepth?: number;
  maxEntries?: number;
  onProgress?: (progress: ScanProgress) => void;
  rejectDriveRoots?: boolean;
  roots: readonly string[];
  signal?: AbortSignal;
}

export interface ScanResult {
  cancelled: boolean;
  candidates: ScanCandidate[];
  issues: ScanIssue[];
  stats: ScanStats;
}

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_ENTRIES = 20_000;
const PROGRESS_FILE_INTERVAL = 200;

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '$recycle.bin',
  'system volume information',
  '.git',
  'node_modules',
]);

interface RootEntry {
  key: string;
  path: string;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function prepareRoots(
  rawRoots: readonly string[],
  rejectDriveRoots: boolean,
): { issues: ScanIssue[]; roots: RootEntry[] } {
  const issues: ScanIssue[] = [];
  const entries: RootEntry[] = [];
  const seenKeys = new Set<string>();

  for (const rawRoot of rawRoots) {
    if (typeof rawRoot !== 'string' || rawRoot.trim().length === 0) {
      issues.push({
        code: 'ROOT_INVALID',
        message: '素材目录参数无效。',
        severity: 'error',
      });
      continue;
    }

    if (!path.isAbsolute(rawRoot)) {
      issues.push({
        code: 'ROOT_NOT_ABSOLUTE',
        message: '素材目录必须是绝对路径。',
        root: rawRoot,
        severity: 'error',
      });
      continue;
    }

    const resolved = path.resolve(rawRoot);

    if (rejectDriveRoots && path.parse(resolved).root === resolved) {
      issues.push({
        code: 'ROOT_IS_DRIVE',
        message: '不允许直接扫描磁盘根目录，请选择具体目录。',
        root: resolved,
        severity: 'error',
      });
      continue;
    }

    const key = toPathKey(resolved);

    if (seenKeys.has(key)) {
      issues.push({
        code: 'ROOT_DUPLICATE',
        message: '素材目录重复，已忽略。',
        root: resolved,
        severity: 'warning',
      });
      continue;
    }

    seenKeys.add(key);
    entries.push({ key, path: resolved });
  }

  entries.sort(
    (left, right) =>
      pathDepth(left.path) - pathDepth(right.path) || left.key.localeCompare(right.key),
  );

  const roots: RootEntry[] = [];

  for (const entry of entries) {
    const parent = roots.find((candidate) => isPathInside(candidate.path, entry.path));

    if (parent) {
      issues.push({
        code: 'ROOT_NESTED',
        message: '素材目录已被上级目录覆盖，已忽略。',
        root: entry.path,
        severity: 'warning',
      });
      continue;
    }

    roots.push(entry);
  }

  return { issues, roots };
}

/**
 * 递归扫描一个或多个素材根目录。
 *
 * - 扩展名先做白名单过滤，命中后再读文件头做魔数校验。
 * - strict 模式下扩展名与内容类别/容器不一致会拒绝；magic-preferred 模式按内容修正并给警告。
 * - 目录始终遍历以发现新增/删除，未命中的文件不读取内容。
 * - 符号链接/junction 不跟随；重复 pathKey、嵌套根目录会被去重。
 * - 返回绝对路径，供主进程内部使用；渲染进程应只拿脱敏后的视图。
 */
export async function scanAssetRoots(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const filterMode: ScanFilterMode =
    options.filterMode === 'magic-preferred' ? 'magic-preferred' : 'strict';
  const maxDepth = normalizeLimit(options.maxDepth, DEFAULT_MAX_DEPTH);
  const maxEntries = normalizeLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const rejectDriveRoots = options.rejectDriveRoots !== false;
  const ignoredNames = new Set(
    [...DEFAULT_IGNORED_DIRECTORIES, ...(options.ignoreDirectories ?? [])].map((name) =>
      name.toLowerCase(),
    ),
  );
  const ignoredPathKeys = new Set((options.ignorePathKeys ?? []).map(toPathKey));
  const signal = options.signal;

  const stats: ScanStats = {
    directoriesVisited: 0,
    duplicates: 0,
    elapsedMs: 0,
    extensionMatches: 0,
    extensionSkipped: 0,
    filesSeen: 0,
    ignoredDirectories: 0,
    magicMatches: 0,
    rejected: 0,
    rootsScanned: 0,
    symlinksSkipped: 0,
  };

  const issues: ScanIssue[] = [];
  const candidates: ScanCandidate[] = [];
  const seenPathKeys = new Set<string>();
  let cancelled = false;
  let stopped = false;
  let limitReported = false;
  let lastProgressFiles = 0;

  const rawRoots = Array.isArray(options.roots) ? options.roots : [];
  const prepared = prepareRoots(rawRoots, rejectDriveRoots);
  issues.push(...prepared.issues);

  if (signal?.aborted) {
    cancelled = true;
  }

  const emitProgress = (currentRoot: string, currentDirectory?: string): void => {
    if (!options.onProgress) {
      return;
    }

    try {
      options.onProgress({
        cancelled,
        currentDirectory,
        currentRoot,
        directoriesVisited: stats.directoriesVisited,
        extensionMatches: stats.extensionMatches,
        filesSeen: stats.filesSeen,
        magicMatches: stats.magicMatches,
        rejected: stats.rejected,
      });
    } catch {
      // 进度回调失败不应中断扫描。
    }
  };

  const addLimitIssue = (): void => {
    if (limitReported) {
      return;
    }

    limitReported = true;
    issues.push({
      code: 'SCAN_LIMIT_REACHED',
      message: '扫描达到深度或文件数上限，结果可能不完整。',
      severity: 'warning',
    });
  };

  const processFile = async (filePath: string, rootPath: string): Promise<void> => {
    const pathKey = toPathKey(filePath);

    if (seenPathKeys.has(pathKey)) {
      stats.duplicates += 1;
      return;
    }

    seenPathKeys.add(pathKey);

    const extension = getFileExtension(filePath);
    const extensionInfo = getExtensionInfo(extension);

    if (!extensionInfo && filterMode === 'strict') {
      stats.extensionSkipped += 1;
      return;
    }

    let fileStat;

    try {
      fileStat = await stat(filePath);
    } catch (error) {
      if (!extensionInfo) {
        stats.extensionSkipped += 1;
        return;
      }

      const code = (error as NodeJS.ErrnoException).code;
      stats.rejected += 1;
      candidates.push({
        detected: { extensionKind: extensionInfo.kind },
        extension,
        fileName: path.basename(filePath),
        issues: [
          {
            code: 'STAT_FAILED',
            message: '读取素材信息失败。',
            path: filePath,
            retryable: code === 'EBUSY' || code === 'EPERM',
            severity: 'error',
          },
        ],
        kind: extensionInfo.kind,
        mtimeMs: 0,
        path: filePath,
        pathKey,
        root: rootPath,
        sizeBytes: 0,
        status: 'unreadable',
      });
      return;
    }

    if (!fileStat.isFile()) {
      return;
    }

    if (extensionInfo) {
      stats.extensionMatches += 1;
    }

    const base = {
      detected: { extensionKind: extensionInfo?.kind } as ScanDetected,
      extension,
      fileName: path.basename(filePath),
      kind: extensionInfo?.kind ?? null,
      mtimeMs: fileStat.mtimeMs,
      path: filePath,
      pathKey,
      root: rootPath,
      sizeBytes: fileStat.size,
    };

    if (fileStat.size === 0) {
      if (!extensionInfo) {
        stats.extensionSkipped += 1;
        return;
      }

      stats.rejected += 1;
      candidates.push({
        ...base,
        issues: [
          {
            code: 'EMPTY_FILE',
            message: '文件为空。',
            path: filePath,
            severity: 'error',
          },
        ],
        status: 'rejected',
      });
      return;
    }

    const magic = await readMagic(filePath, fileStat.size);

    if (magic.status === 'unreadable') {
      if (!extensionInfo) {
        stats.extensionSkipped += 1;
        return;
      }

      const locked =
        magic.errorCode === 'EACCES' || magic.errorCode === 'EBUSY' || magic.errorCode === 'EPERM';
      stats.rejected += 1;
      candidates.push({
        ...base,
        issues: [
          {
            code: locked ? 'FILE_LOCKED' : 'MAGIC_UNREADABLE',
            message: locked ? '文件被占用，暂时无法读取。' : '读取文件头失败。',
            path: filePath,
            retryable: locked,
            severity: 'error',
          },
        ],
        status: 'unreadable',
      });
      return;
    }

    if (magic.status === 'empty' || magic.status === 'too-short') {
      if (!extensionInfo) {
        stats.extensionSkipped += 1;
        return;
      }

      stats.rejected += 1;
      candidates.push({
        ...base,
        issues: [
          {
            code: magic.status === 'empty' ? 'EMPTY_FILE' : 'FILE_TOO_SHORT',
            message: magic.status === 'empty' ? '文件为空。' : '文件过短，无法识别格式。',
            path: filePath,
            severity: 'error',
          },
        ],
        status: 'rejected',
      });
      return;
    }

    const detection = magic.detection;

    if (!detection) {
      if (!extensionInfo) {
        stats.extensionSkipped += 1;
        return;
      }

      stats.rejected += 1;
      candidates.push({
        ...base,
        issues: [
          {
            code: 'MAGIC_NOT_DETECTED',
            message: '无法识别文件格式。',
            path: filePath,
            severity: 'error',
          },
        ],
        status: 'rejected',
      });
      return;
    }

    stats.magicMatches += 1;

    const detected: ScanDetected = {
      ...(detection.brand ? { brand: detection.brand } : {}),
      container: detection.container,
      extensionKind: extensionInfo?.kind,
      magicKind: detection.kind,
    };
    const fileIssues: ScanIssue[] = [];
    let status: ScanCandidateStatus = 'ready';
    const kind: AssetKind = detection.kind;

    if (extensionInfo) {
      const kindMatches = extensionInfo.kind === detection.kind;
      const containerMatches = extensionInfo.containers.includes(detection.container);

      if (!kindMatches || !containerMatches) {
        if (filterMode === 'strict') {
          status = 'rejected';
          fileIssues.push({
            code: 'EXTENSION_MAGIC_MISMATCH',
            message: `扩展名 .${extension} 与文件内容（${detection.container}）不一致。`,
            path: filePath,
            severity: 'error',
          });
        } else {
          fileIssues.push({
            code: 'EXTENSION_MAGIC_MISMATCH',
            message: `扩展名 .${extension} 与文件内容（${detection.container}）不一致，已按内容识别。`,
            path: filePath,
            severity: 'warning',
          });
        }
      }
    } else {
      fileIssues.push({
        code: 'EXTENSION_NOT_SUPPORTED',
        message: '扩展名不在支持列表，已按文件内容识别。',
        path: filePath,
        severity: 'warning',
      });
    }

    let afterStat;

    try {
      afterStat = await stat(filePath);
    } catch {
      afterStat = null;
    }

    if (afterStat && (afterStat.size !== fileStat.size || afterStat.mtimeMs !== fileStat.mtimeMs)) {
      status = 'changed';
      fileIssues.push({
        code: 'CHANGED_DURING_SCAN',
        message: '文件在扫描期间发生变化，本次跳过。',
        path: filePath,
        severity: 'warning',
      });
    }

    if (status !== 'ready') {
      stats.rejected += 1;
    }

    candidates.push({
      ...base,
      detected,
      issues: fileIssues,
      kind,
      status,
    });
  };

  for (const root of prepared.roots) {
    if (stopped || cancelled) {
      break;
    }

    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    let rootStat;

    try {
      rootStat = await stat(root.path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      issues.push({
        code: code === 'ENOENT' ? 'ROOT_NOT_FOUND' : 'ROOT_UNREADABLE',
        message: code === 'ENOENT' ? '素材目录不存在。' : '素材目录不可读。',
        root: root.path,
        severity: 'error',
      });
      continue;
    }

    stats.rootsScanned += 1;

    if (rootStat.isFile()) {
      if (stats.filesSeen >= maxEntries) {
        addLimitIssue();
        break;
      }

      stats.filesSeen += 1;
      await processFile(root.path, root.path);
      emitProgress(root.path);
      continue;
    }

    if (!rootStat.isDirectory()) {
      issues.push({
        code: 'ROOT_UNSUPPORTED',
        message: '素材路径既不是文件也不是目录。',
        root: root.path,
        severity: 'error',
      });
      continue;
    }

    const stack: Array<{ depth: number; directory: string }> = [{ depth: 0, directory: root.path }];

    while (stack.length > 0 && !stopped && !cancelled) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }

      const current = stack.pop()!;

      if (ignoredPathKeys.has(toPathKey(current.directory))) {
        stats.ignoredDirectories += 1;
        continue;
      }

      let entries;

      try {
        entries = await readdir(current.directory, { withFileTypes: true });
      } catch {
        issues.push({
          code: 'DIRECTORY_UNREADABLE',
          message: '素材目录不可读。',
          path: current.directory,
          severity: 'warning',
        });
        continue;
      }

      stats.directoriesVisited += 1;
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

      for (const entry of entries) {
        if (stopped || cancelled) {
          break;
        }

        if (signal?.aborted) {
          cancelled = true;
          break;
        }

        if (stats.filesSeen >= maxEntries) {
          addLimitIssue();
          stopped = true;
          break;
        }

        if (entry.isSymbolicLink()) {
          stats.symlinksSkipped += 1;
          continue;
        }

        const entryPath = path.join(current.directory, entry.name);

        if (entry.isDirectory()) {
          if (ignoredNames.has(entry.name.toLowerCase())) {
            stats.ignoredDirectories += 1;
            continue;
          }

          if (current.depth + 1 > maxDepth) {
            addLimitIssue();
            continue;
          }

          stack.push({ depth: current.depth + 1, directory: entryPath });
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        stats.filesSeen += 1;
        await processFile(entryPath, root.path);

        if (stats.filesSeen - lastProgressFiles >= PROGRESS_FILE_INTERVAL) {
          lastProgressFiles = stats.filesSeen;
          emitProgress(root.path, current.directory);
        }
      }

      emitProgress(root.path, current.directory);
    }

    if (cancelled || stopped) {
      break;
    }
  }

  if (cancelled) {
    issues.push({
      code: 'SCAN_CANCELLED',
      message: '扫描已取消，返回部分结果。',
      severity: 'warning',
    });
  }

  if (stats.symlinksSkipped > 0) {
    issues.push({
      code: 'SYMLINKS_SKIPPED',
      message: `已跳过 ${stats.symlinksSkipped} 个符号链接/快捷方式。`,
      severity: 'warning',
    });
  }

  candidates.sort((left, right) => left.pathKey.localeCompare(right.pathKey));

  return {
    cancelled,
    candidates,
    issues,
    stats: {
      ...stats,
      elapsedMs: Date.now() - startedAt,
    },
  };
}
