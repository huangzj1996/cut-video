import path from 'node:path';
import type { MusicAsset, StoredProject } from '@miaoma/video-project';

/**
 * 编辑器刚添加、尚未自动保存的音乐素材登记。
 *
 * `asset://` 协议按磁盘上的 project.json 解析素材；刚点选音乐时新素材还在
 * 渲染进程内存里，直接请求会 404（"无法加载媒体"）。把路径先登记到主进程，
 * 协议解析时把它并进工程，等保存成功后（asset 已落盘）再清理。
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface PendingMusicAsset {
  assetId: string;
  path: string;
}

export function isPathInsideDirectory(root: string, filePath: string): boolean {
  if (!path.isAbsolute(filePath)) {
    return false;
  }

  const relative = path.relative(path.resolve(root), path.resolve(filePath));

  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * 只接受形如 `music-<uuid>` 的资产 ID，且路径必须落在内置音乐库目录内：
 * 这样新登记的路径不会变成绕过工程白名单的任意文件读取。
 */
export function normalizePendingMusicAsset(input: {
  assetId: string;
  filePath: string;
  projectId: string;
  root: string;
}): PendingMusicAsset | null {
  if (!ID_PATTERN.test(input.projectId) || !ID_PATTERN.test(input.assetId)) {
    return null;
  }

  if (!isPathInsideDirectory(input.root, input.filePath)) {
    return null;
  }

  return { assetId: input.assetId, path: path.resolve(input.filePath) };
}

export interface PendingMusicAssetRegistry {
  list(projectId: string): PendingMusicAsset[];
  prune(projectId: string, savedAssetIds: readonly string[]): void;
  register(projectId: string, asset: PendingMusicAsset): void;
}

export function createPendingMusicAssetRegistry(): PendingMusicAssetRegistry {
  const byProject = new Map<string, Map<string, PendingMusicAsset>>();

  return {
    list(projectId) {
      return [...(byProject.get(projectId)?.values() ?? [])];
    },
    prune(projectId, savedAssetIds) {
      const assets = byProject.get(projectId);

      if (!assets) {
        return;
      }

      for (const assetId of savedAssetIds) {
        assets.delete(assetId);
      }

      if (assets.size === 0) {
        byProject.delete(projectId);
      }
    },
    register(projectId, asset) {
      const assets = byProject.get(projectId) ?? new Map<string, PendingMusicAsset>();

      assets.set(asset.assetId, asset);
      byProject.set(projectId, assets);
    },
  };
}

/**
 * 把未保存的音乐素材并入工程视图，供 `asset://` 协议解析使用。
 * 已保存的素材优先，重复 ID 不会覆盖磁盘记录。
 */
export function withPendingMusicAssets(
  project: StoredProject,
  pending: readonly PendingMusicAsset[],
): StoredProject {
  if (pending.length === 0) {
    return project;
  }

  const knownIds = new Set(project.assets.music.map((asset) => asset.id));
  const extraAssets: MusicAsset[] = pending
    .filter((asset) => !knownIds.has(asset.assetId))
    .map((asset) => ({ durationMs: 0, id: asset.assetId, path: asset.path }));

  if (extraAssets.length === 0) {
    return project;
  }

  return {
    ...project,
    assets: { ...project.assets, music: [...project.assets.music, ...extraAssets] },
  };
}
