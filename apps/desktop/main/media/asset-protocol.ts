import path from 'node:path';
import type { StoredProject } from '@miaoma/video-project';

/**
 * 受限媒体协议 `asset://<projectId>/<assetId>` 的纯解析与响应规划。
 *
 * 渲染进程只持有 assetId；主进程按工程登记的资产白名单解析真实路径，
 * 不接受任意文件路径。真正的文件读取与 Electron 协议注册在 handler 中完成。
 */

export const ASSET_SCHEME = 'asset';
export const ASSET_SCHEME_PRIVILEGES = {
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

const MIME_TYPES: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

export interface AssetUrlParts {
  assetId: string;
  projectId: string;
}

export type AssetRange =
  { kind: 'full' } | { end: number; kind: 'partial'; start: number } | { kind: 'unsatisfiable' };

export type AssetTarget = { filePath: string; ok: true } | { ok: false; status: 403 | 404 };

export interface AssetFileStat {
  isFile: boolean;
  size: number;
}

export interface AssetResponsePlan {
  body?: { end: number; filePath: string; start: number };
  headers: Record<string, string>;
  status: number;
  text?: string;
}

export interface AssetRequestPlanInput {
  method: string;
  project: StoredProject | null;
  rangeHeader?: string | null;
  rawUrl: string;
  stat(filePath: string): AssetFileStat | null;
}

export function parseAssetUrl(rawUrl: string): AssetUrlParts | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${ASSET_SCHEME}:`) {
    return null;
  }

  const projectId = url.hostname;

  if (!ID_PATTERN.test(projectId)) {
    return null;
  }

  let assetId: string;

  try {
    assetId = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }

  if (!ID_PATTERN.test(assetId)) {
    return null;
  }

  return { assetId, projectId };
}

/**
 * 只解析工程 assets 中登记的资产；字幕资产没有文件路径，不参与媒体加载。
 */
export function resolveAssetTarget(project: StoredProject, assetId: string): AssetTarget {
  if (!ID_PATTERN.test(assetId)) {
    return { ok: false, status: 403 };
  }

  const registered = [
    ...project.assets.videos,
    ...project.assets.voices,
    ...project.assets.music,
    ...project.assets.thumbnails,
  ];

  const asset = registered.find((entry) => entry.id === assetId);

  if (!asset || !path.isAbsolute(asset.path)) {
    return { ok: false, status: 404 };
  }

  return { filePath: asset.path, ok: true };
}

export function mimeTypeForPath(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function parseRangeHeader(rangeHeader: string | null | undefined, size: number): AssetRange {
  if (!rangeHeader) {
    return { kind: 'full' };
  }

  const match = RANGE_PATTERN.exec(rangeHeader.trim());

  if (!match || size <= 0) {
    return { kind: 'unsatisfiable' };
  }

  const [, rawStart = '', rawEnd = ''] = match;

  if (rawStart === '' && rawEnd === '') {
    return { kind: 'unsatisfiable' };
  }

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: 'unsatisfiable' };
    }

    return { end: size - 1, kind: 'partial', start: Math.max(0, size - suffixLength) };
  }

  const start = Number(rawStart);

  if (!Number.isSafeInteger(start) || start >= size) {
    return { kind: 'unsatisfiable' };
  }

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);

  if (!Number.isSafeInteger(end) || end < start) {
    return { kind: 'unsatisfiable' };
  }

  return { end, kind: 'partial', start };
}

function textPlan(status: number, text: string, headers: Record<string, string> = {}) {
  return {
    headers: {
      'Content-Length': String(Buffer.byteLength(text)),
      'Content-Type': 'text/plain; charset=utf-8',
      ...headers,
    },
    status,
    text,
  } satisfies AssetResponsePlan;
}

/**
 * 规划一次资产请求的响应：方法、白名单、缺失文件、MIME 与 Range 都在这里决定。
 * 不读取文件内容，便于单测覆盖 200/206/416/404/403/405。
 */
export function planAssetResponse(input: AssetRequestPlanInput): AssetResponsePlan {
  if (input.method !== 'GET' && input.method !== 'HEAD') {
    return textPlan(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  const parsed = parseAssetUrl(input.rawUrl);

  if (!parsed) {
    return textPlan(403, 'Forbidden');
  }

  if (!input.project) {
    return textPlan(404, 'Not Found');
  }

  if (parsed.projectId !== input.project.project.projectId) {
    return textPlan(404, 'Not Found');
  }

  const target = resolveAssetTarget(input.project, parsed.assetId);

  if (!target.ok) {
    return textPlan(target.status, target.status === 403 ? 'Forbidden' : 'Not Found');
  }

  let stat: AssetFileStat | null;

  try {
    stat = input.stat(target.filePath);
  } catch {
    stat = null;
  }

  if (!stat || !stat.isFile) {
    return textPlan(404, 'Not Found');
  }

  const range = parseRangeHeader(input.rangeHeader, stat.size);
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeTypeForPath(target.filePath),
  };

  if (range.kind === 'unsatisfiable') {
    return {
      headers: {
        ...headers,
        'Content-Length': '0',
        'Content-Range': `bytes */${stat.size}`,
      },
      status: 416,
    };
  }

  const start = range.kind === 'partial' ? range.start : 0;
  const end = range.kind === 'partial' ? range.end : Math.max(0, stat.size - 1);
  const length = stat.size === 0 ? 0 : end - start + 1;

  headers['Content-Length'] = String(length);

  if (range.kind === 'partial') {
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }

  const plan: AssetResponsePlan = {
    headers,
    status: range.kind === 'partial' ? 206 : 200,
  };

  if (input.method === 'GET' && length > 0) {
    plan.body = { end, filePath: target.filePath, start };
  }

  return plan;
}
