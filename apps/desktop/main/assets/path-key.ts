import path from 'node:path';

const CASE_INSENSITIVE_PATHS = process.platform === 'win32';

/**
 * 将路径规范化为稳定的比较键。
 *
 * - 绝对路径、去掉尾部多余分隔符
 * - NFC 归一化，避免 macOS/Windows 的 Unicode 组合差异
 * - Windows 大小写不敏感，统一小写
 *
 * 原始绝对路径仍用于显示和文件系统访问，不要用这个键去读写文件。
 */
export function toPathKey(input: string): string {
  const resolved = path.resolve(input);
  const root = path.parse(resolved).root;
  const trimmed = resolved.length > root.length ? resolved.replace(/[\\/]+$/, '') : resolved;
  const normalized = trimmed.normalize('NFC');

  return CASE_INSENSITIVE_PATHS ? normalized.toLowerCase() : normalized;
}

export function isSamePath(left: string, right: string): boolean {
  return toPathKey(left) === toPathKey(right);
}

export function isPathInside(parent: string, child: string): boolean {
  const parentKey = toPathKey(parent);
  const childKey = toPathKey(child);

  if (parentKey === childKey) {
    return false;
  }

  const prefix = parentKey.endsWith(path.sep) ? parentKey : `${parentKey}${path.sep}`;
  return childKey.startsWith(prefix);
}

/**
 * 路径段数，用于让父目录先于子目录参与嵌套去重。
 */
export function pathDepth(input: string): number {
  return toPathKey(input)
    .split(path.sep)
    .filter((segment) => segment.length > 0).length;
}
