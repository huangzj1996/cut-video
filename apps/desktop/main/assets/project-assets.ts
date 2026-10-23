import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProjectAssets, VideoAsset } from '@miaoma/video-project';
import type { AssetSelectionManifest } from './asset-manifest';
import { ASSET_MANIFEST_VERSION } from './asset-manifest';
import { scanAssetRoots, type ScanCandidate, type ScanResult } from './asset-scanner';
import type { VideoMetadata } from './video-probe';
import { IpcError } from '../ipc-error';

export type ProbeVideoFn = (candidate: ScanCandidate) => Promise<VideoMetadata | null>;

export interface PreparedProjectAssets {
  assets: ProjectAssets;
  probes: ReadonlyMap<string, VideoMetadata>;
  roots: string[];
  scanResult: ScanResult;
}

function normalizeAssetPath(input: string): string {
  const trimmed = input.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

/**
 * 创建工程前解析用户输入的素材路径：
 * 1. 绝对路径校验；
 * 2. 扩展名 + 魔数扫描；
 * 3. 对通过校验的视频逐个探测元数据；
 * 4. 至少需要一个成功解析的视频，否则不创建工程。
 */
export async function prepareProjectAssets(
  assetPath: string,
  probe: ProbeVideoFn,
): Promise<PreparedProjectAssets> {
  const normalizedPath = normalizeAssetPath(assetPath);

  if (!normalizedPath || !path.isAbsolute(normalizedPath)) {
    throw new IpcError('ASSET_INVALID_ARGUMENT', '请输入本机素材的绝对路径。');
  }

  let scanResult: ScanResult;

  try {
    scanResult = await scanAssetRoots({
      filterMode: 'strict',
      roots: [normalizedPath],
    });
  } catch {
    throw new IpcError('ASSET_SCAN_FAILED', '扫描视频素材失败。', true);
  }

  const rootIssue = scanResult.issues.find((issue) =>
    [
      'ROOT_INVALID',
      'ROOT_IS_DRIVE',
      'ROOT_NESTED',
      'ROOT_NOT_ABSOLUTE',
      'ROOT_NOT_FOUND',
      'ROOT_UNREADABLE',
      'ROOT_UNSUPPORTED',
    ].includes(issue.code),
  );

  if (rootIssue) {
    if (rootIssue.code === 'ROOT_NOT_FOUND') {
      throw new IpcError('ASSET_PATH_NOT_FOUND', '素材路径不存在。');
    }

    if (rootIssue.code === 'ROOT_IS_DRIVE') {
      throw new IpcError('ASSET_INVALID_ARGUMENT', '请选择具体素材目录，不要直接扫描磁盘根目录。');
    }

    throw new IpcError('ASSET_INVALID_ARGUMENT', '素材路径无效或不可读。');
  }

  const videoCandidates = scanResult.candidates.filter(
    (candidate) => (candidate.detected.extensionKind ?? candidate.kind) === 'video',
  );
  const readyVideos = videoCandidates.filter((candidate) => candidate.status === 'ready');

  if (readyVideos.length === 0) {
    throw new IpcError('ASSET_NO_VIDEOS', '未在指定路径找到可用的视频素材。');
  }

  const videos: VideoAsset[] = [];
  const probes = new Map<string, VideoMetadata>();

  for (const candidate of readyVideos) {
    let metadata: VideoMetadata | null;

    try {
      metadata = await probe(candidate);
    } catch {
      metadata = null;
    }

    if (!metadata) {
      continue;
    }

    probes.set(candidate.pathKey, metadata);
    videos.push({
      durationMs: metadata.durationMs,
      fps: metadata.fps,
      height: metadata.height,
      id: randomUUID(),
      mediaType: 'video',
      path: candidate.path,
      thumbnailIds: [],
      width: metadata.width,
    });
  }

  if (videos.length === 0) {
    throw new IpcError(
      'ASSET_PROBE_FAILED',
      '视频元数据解析失败，请确认 ffprobe 可用且文件可解码。',
    );
  }

  return {
    assets: {
      music: [],
      subtitles: [],
      thumbnails: [],
      videos,
      voices: [],
    },
    probes,
    roots: [normalizedPath],
    scanResult,
  };
}

/**
 * 生成写入 `<project>/inputs/assets.json` 的扫描清单。
 * 清单独供主进程使用，不通过 IPC 下发。
 */
export function buildAssetSelectionManifest(
  projectId: string,
  prepared: PreparedProjectAssets,
): AssetSelectionManifest {
  return {
    items: prepared.scanResult.candidates.map((candidate) => ({
      detected: candidate.detected,
      extension: candidate.extension,
      fileName: candidate.fileName,
      issues: candidate.issues,
      itemId: randomUUID(),
      kind: candidate.kind,
      mtimeMs: candidate.mtimeMs,
      path: candidate.path,
      pathKey: candidate.pathKey,
      probe: prepared.probes.get(candidate.pathKey),
      sizeBytes: candidate.sizeBytes,
      status: candidate.status,
    })),
    issues: prepared.scanResult.issues,
    manifestVersion: ASSET_MANIFEST_VERSION,
    projectId,
    roots: prepared.roots,
    scannedAt: new Date().toISOString(),
  };
}
