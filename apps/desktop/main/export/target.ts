import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ExportDefaultTarget } from '../../shared/ipc-contract';
import { IpcError } from '../ipc-error';
import { EXPORT_MESSAGES } from './messages';

const EXPORT_DIRECTORY_NAME = '导出';
// eslint-disable-next-line no-control-regex -- Windows 文件名不允许控制字符。
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/g;
const MAX_BASE_NAME_LENGTH = 80;
const MAX_TARGET_PATH_LENGTH = 1000;
const FALLBACK_PROJECT_NAME = '未命名工程';
const MAX_DUPLICATE_SUFFIX = 100;

/** 去掉 Windows 文件名非法字符，保留中文与常见符号。 */
export function sanitizeExportFileName(name: string): string {
  const cleaned = name
    .replace(INVALID_FILENAME_CHARS, '-')
    .replace(TRAILING_DOTS_OR_SPACES, '')
    .trim();

  if (cleaned.length === 0) {
    return FALLBACK_PROJECT_NAME;
  }

  return (
    cleaned.slice(0, MAX_BASE_NAME_LENGTH).replace(TRAILING_DOTS_OR_SPACES, '') ||
    FALLBACK_PROJECT_NAME
  );
}

/** 导出文件名使用本地时间：yyyyMMdd-HHmmss。 */
export function formatExportTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/**
 * 默认导出位置 = 设置里的默认工程目录下的「导出」子目录。
 * 重名时追加 -1、-2 后缀，不覆盖已有成品。
 */
export function buildDefaultExportTarget(input: {
  exists?: (candidate: string) => boolean;
  now: Date;
  projectName: string;
  projectRoot: string;
}): ExportDefaultTarget {
  const directory = path.join(input.projectRoot, EXPORT_DIRECTORY_NAME);
  const baseName = `${sanitizeExportFileName(input.projectName)}-${formatExportTimestamp(input.now)}`;
  const exists = input.exists ?? existsSync;

  for (let suffix = 0; suffix < MAX_DUPLICATE_SUFFIX; suffix += 1) {
    const fileName = suffix === 0 ? `${baseName}.mp4` : `${baseName}-${suffix}.mp4`;
    const candidate = path.join(directory, fileName);

    if (!exists(candidate)) {
      return { directory, fileName, path: candidate };
    }
  }

  throw new IpcError('EXPORT_TARGET_UNWRITABLE', EXPORT_MESSAGES.targetTooManyDuplicates);
}

/** 未完成的成品写目标同目录的 .partial 文件；提交时再 rename。 */
export function partialPathFor(targetPath: string): string {
  return `${targetPath}.partial`;
}

/** 预混音轨是临时产物：与成品同目录，命名挂在 .partial 之后，成功/失败/取消都要清理。 */
export function premixPartialPathFor(targetPath: string): string {
  return `${partialPathFor(targetPath)}.wav`;
}

export function assertExportTargetPath(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new IpcError('IPC_INVALID_ARGUMENT', '导出位置无效。');
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_PATH_LENGTH) {
    throw new IpcError('IPC_INVALID_ARGUMENT', '导出位置无效。');
  }

  const resolved = path.resolve(trimmed);

  if (!resolved.toLowerCase().endsWith('.mp4')) {
    throw new IpcError('IPC_INVALID_ARGUMENT', '导出文件必须是 .mp4。');
  }

  return resolved;
}
