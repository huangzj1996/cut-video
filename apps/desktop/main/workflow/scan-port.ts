import { extractKeyframes, probeVideoResult } from '@miaoma/video-agent';
import type { AssetScanPort, AssetScanRequest } from '@miaoma/video-agent/workflow';
import {
  AssetManifestSchema,
  type AssetManifest,
  type AssetManifestIssue,
  type AssetProbeSummary,
  type AssetKind,
  type KeyframeRef,
} from '@miaoma/video-project';
import { attachKeyframes, type KeyframeAttachment } from '../assets/keyframe-assets';
import { toPathKey } from '../assets/path-key';
import { buildAssetSelectionManifest, prepareProjectAssets } from '../assets/project-assets';
import { IpcError } from '../ipc-error';
import { isBinaryAvailable } from '../media/binary-check';
import { resolveMediaBinary } from '../media/ffmpeg-path';
import type { ProjectStore } from '../projects/project-store';

export interface DesktopScanPortOptions {
  getProjectStore: () => ProjectStore;
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

function emptyManifest(projectId: string): AssetManifest {
  return AssetManifestSchema.parse({
    schemaVersion: '1.0.0',
    manifestVersion: 1,
    projectId,
    scannedAt: new Date().toISOString(),
    roots: [],
    items: [],
    stats: {
      filesSeen: 0,
      directoriesVisited: 0,
      duplicates: 0,
      rejected: 0,
      unreadable: 0,
    },
    issues: [
      {
        code: 'NO_ASSET_PATH',
        message: '未选择素材目录，后续校验会阻止保存。',
        severity: 'warning',
      },
    ],
  });
}

function toManifestIssue(issue: {
  code: string;
  message: string;
  path?: string;
  severity?: 'error' | 'warning' | 'info';
}): AssetManifestIssue {
  return {
    code: issue.code,
    message: issue.message,
    ...(issue.path !== undefined ? { path: issue.path } : {}),
    ...(issue.severity !== undefined ? { severity: issue.severity } : {}),
  };
}

function toProbeSummary(metadata: {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  container?: string;
  codec?: string;
  bitRate?: number;
  audio?: unknown;
  isHdr: boolean;
  isVfr: boolean;
  rotation: number;
}): AssetProbeSummary {
  return {
    durationMs: Math.max(0, Math.round(metadata.durationMs)),
    width: Math.max(1, Math.round(metadata.width)),
    height: Math.max(1, Math.round(metadata.height)),
    fps: metadata.fps,
    ...(metadata.container !== undefined ? { container: metadata.container } : {}),
    ...(metadata.codec !== undefined ? { codec: metadata.codec } : {}),
    ...(metadata.bitRate !== undefined
      ? { bitRate: Math.max(0, Math.round(metadata.bitRate)) }
      : {}),
    hasAudio: metadata.audio !== undefined,
    isHdr: metadata.isHdr,
    isVfr: metadata.isVfr,
    rotation: Math.round(metadata.rotation),
  };
}

function buildManifest(
  projectId: string,
  prepared: Awaited<ReturnType<typeof prepareProjectAssets>>,
  attached: KeyframeAttachment,
): AssetManifest {
  const videoByPath = new Map(
    attached.assets.videos.map((video) => [toPathKey(video.path), video]),
  );
  const thumbnailById = new Map(
    attached.assets.thumbnails.map((thumbnail) => [thumbnail.id, thumbnail]),
  );

  return AssetManifestSchema.parse({
    schemaVersion: '1.0.0',
    manifestVersion: 1,
    projectId,
    scannedAt: new Date().toISOString(),
    roots: prepared.roots,
    items: prepared.scanResult.candidates.map((candidate) => {
      const video = videoByPath.get(candidate.pathKey);
      const metadata = prepared.probes.get(candidate.pathKey);
      const keyframes: KeyframeRef[] = (video?.thumbnailIds ?? [])
        .map((id) => thumbnailById.get(id))
        .filter((thumbnail): thumbnail is NonNullable<typeof thumbnail> => thumbnail !== undefined)
        .map((thumbnail) => ({
          thumbnailId: thumbnail.id,
          path: thumbnail.path,
          timeMs: thumbnail.timeMs,
          width: thumbnail.width,
          height: thumbnail.height,
        }));

      return {
        assetId: video?.id ?? null,
        kind: (candidate.kind ?? candidate.detected.extensionKind ?? 'video') as AssetKind,
        path: candidate.path,
        fileName: candidate.fileName,
        sizeBytes: Math.max(0, Math.round(candidate.sizeBytes)),
        mtimeMs: Math.max(0, Math.round(candidate.mtimeMs)),
        status: candidate.status,
        ...(metadata !== undefined ? { probe: toProbeSummary(metadata) } : {}),
        keyframes,
        issues: candidate.issues.slice(0, 20).map(toManifestIssue),
      };
    }),
    stats: {
      filesSeen: prepared.scanResult.stats.filesSeen,
      directoriesVisited: prepared.scanResult.stats.directoriesVisited,
      duplicates: prepared.scanResult.stats.duplicates,
      rejected: prepared.scanResult.stats.rejected,
      unreadable: prepared.scanResult.candidates.filter(
        (candidate) => candidate.status === 'unreadable',
      ).length,
    },
    issues: prepared.scanResult.issues.slice(0, 100).map(toManifestIssue),
  });
}

/**
 * 桌面主进程的素材扫描端口：
 * 扫描 + ffprobe + 关键帧 → 更新 project.assets / inputs/assets.json，
 * 同时返回工作流使用的便携 AssetManifest。
 */
export function createDesktopScanPort(options: DesktopScanPortOptions): AssetScanPort {
  return {
    async scanAssets(request: AssetScanRequest): Promise<AssetManifest> {
      const store = options.getProjectStore();
      const project = store.get(request.projectId);
      const assetPath = request.assetPath?.trim();

      if (!assetPath) {
        return emptyManifest(request.projectId);
      }

      const common = {
        isPackaged: options.isPackaged,
        appPath: options.appPath,
        resourcesPath: options.resourcesPath,
      } as const;
      const ffprobePath = resolveMediaBinary({ ...common, name: 'ffprobe' });

      if (!isBinaryAvailable(ffprobePath)) {
        throw new IpcError(
          'ASSET_PROBE_UNAVAILABLE',
          '未找到 ffprobe。请将 ffprobe.exe 放入 resources/ffmpeg/，或设置 MIAOMA_FFPROBE_PATH。',
        );
      }

      const ffmpegPath = resolveMediaBinary({ ...common, name: 'ffmpeg' });

      if (!isBinaryAvailable(ffmpegPath)) {
        throw new IpcError(
          'ASSET_KEYFRAME_UNAVAILABLE',
          '未找到 ffmpeg。请将 ffmpeg.exe 放入 resources/ffmpeg/，或设置 MIAOMA_FFMPEG_PATH。',
        );
      }

      request.onProgress?.({
        current: 0,
        total: 1,
        detail: '正在扫描素材目录',
      });

      const prepared = await prepareProjectAssets(
        assetPath,
        (candidate) => probeVideoResult(ffprobePath, candidate.path),
        {
          ...(request.signal ? { signal: request.signal } : {}),
          onProgress: (progress) => {
            request.onProgress?.({
              current: progress.filesSeen,
              total: Math.max(progress.filesSeen, progress.extensionMatches, 1),
              detail: `已扫描 ${progress.filesSeen} 个文件`,
            });
          },
        },
      );

      // 同一路径的素材复用已有 assetId，保证重开工程/重跑节点时引用稳定。
      const existingIds = new Map(
        project.assets.videos.map((video) => [toPathKey(video.path), video.id]),
      );
      const preparedWithStableIds = {
        ...prepared,
        assets: {
          ...prepared.assets,
          videos: prepared.assets.videos.map((video) => ({
            ...video,
            id: existingIds.get(toPathKey(video.path)) ?? video.id,
          })),
        },
      };

      request.onProgress?.({
        current: preparedWithStableIds.assets.videos.length,
        total: preparedWithStableIds.assets.videos.length,
        detail: '正在提取关键帧',
      });

      const attached = await attachKeyframes(
        preparedWithStableIds,
        (source) =>
          extractKeyframes(source, {
            cacheRoot: store.getKeyframeCacheDirectory(request.projectId),
            ffmpegPath,
          }),
        request.signal ? { signal: request.signal } : {},
      );

      store.replaceAssets(request.projectId, attached.assets);
      store.writeAssetManifest(
        request.projectId,
        buildAssetSelectionManifest(request.projectId, preparedWithStableIds, {
          keyframeCacheKeys: attached.cacheKeys,
          keyframeCounts: attached.frameCounts,
          keyframeErrors: attached.errors,
        }),
      );

      return buildManifest(request.projectId, preparedWithStableIds, attached);
    },
  };
}
