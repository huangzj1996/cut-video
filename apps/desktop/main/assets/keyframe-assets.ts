import { randomUUID } from 'node:crypto';
import {
  toMediaErrorSummary,
  type KeyframeExtractionResult,
  type MediaErrorSummary,
} from '@miaoma/video-agent';
import type { ProjectAssets, ThumbnailAsset, VideoAsset } from '@miaoma/video-project';
import { toPathKey } from './path-key';
import type { PreparedProjectAssets } from './project-assets';

export interface KeyframeSourceInput {
  durationMs: number;
  height: number;
  path: string;
  width: number;
}

export type ExtractKeyframesFn = (source: KeyframeSourceInput) => Promise<KeyframeExtractionResult>;

export interface KeyframeAttachment {
  assets: ProjectAssets;
  /** pathKey → 内容哈希缓存键 */
  cacheKeys: ReadonlyMap<string, string>;
  /** pathKey → 失败原因；不阻断工程创建 */
  errors: ReadonlyMap<string, MediaErrorSummary>;
  /** pathKey → 成功写入的帧数 */
  frameCounts: ReadonlyMap<string, number>;
}

/**
 * 为已探测的视频提取关键帧并映射为 ThumbnailAsset。
 *
 * - 单个视频失败只记录错误，不影响其他视频或工程创建；
 * - `VideoAsset.thumbnailIds` 引用新生成的缩略图；
 * - 返回的 maps 以 pathKey 为键，供素材清单记录缓存键、帧数与失败原因。
 */
export async function attachKeyframes(
  prepared: PreparedProjectAssets,
  extract: ExtractKeyframesFn,
): Promise<KeyframeAttachment> {
  const thumbnails: ThumbnailAsset[] = [];
  const videos: VideoAsset[] = [];
  const cacheKeys = new Map<string, string>();
  const errors = new Map<string, MediaErrorSummary>();
  const frameCounts = new Map<string, number>();

  for (const video of prepared.assets.videos) {
    const pathKey = toPathKey(video.path);
    const metadata = prepared.probes.get(pathKey);
    const thumbnailIds: string[] = [];

    if (metadata) {
      try {
        const result = await extract({
          durationMs: metadata.durationMs,
          height: metadata.height,
          path: video.path,
          width: metadata.width,
        });

        for (const frame of result.frames) {
          const id = randomUUID();

          thumbnails.push({
            height: frame.height,
            id,
            path: frame.path,
            timeMs: frame.timeMs,
            width: frame.width,
          });
          thumbnailIds.push(id);
        }

        cacheKeys.set(pathKey, result.cacheKey);
        frameCounts.set(pathKey, result.frames.length);
      } catch (error) {
        errors.set(pathKey, toMediaErrorSummary(error));
      }
    }

    videos.push({ ...video, thumbnailIds });
  }

  return {
    assets: { ...prepared.assets, thumbnails, videos },
    cacheKeys,
    errors,
    frameCounts,
  };
}
