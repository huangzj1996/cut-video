import type { VideoAsset } from '@miaoma/video-project';

/**
 * v1 的视频能力边界：只直接支持 H.264、SDR、恒定帧率的视频。
 * 预览与导出共用这一份判定，避免两处对“能不能用”给出不同答案；
 * 面向用户的文案由各自模块负责（导出在 `main/export/messages.ts`）。
 */
export const PLAYABLE_VIDEO_CODECS = new Set(['avc', 'avc1', 'h264']);

export type VideoCapabilityProblemKind =
  'unsupported-codec' | 'unsupported-hdr' | 'unsupported-vfr';

export type VideoCapabilityProblem =
  | { codec: string; kind: 'unsupported-codec' }
  | { kind: 'unsupported-hdr' }
  | { kind: 'unsupported-vfr' };

/**
 * 判断视频素材是否越过 v1 能力边界。
 * 图片素材没有这些能力属性，永远返回 null；没有 codec 的旧工程按历史 H.264 处理。
 */
export function findVideoCapabilityProblem(asset: VideoAsset): VideoCapabilityProblem | null {
  if (asset.mediaType === 'image') {
    return null;
  }

  const codec = asset.codec?.toLowerCase();

  if (codec !== undefined && !PLAYABLE_VIDEO_CODECS.has(codec)) {
    return { codec: asset.codec ?? '', kind: 'unsupported-codec' };
  }

  if (asset.isHdr) {
    return { kind: 'unsupported-hdr' };
  }

  if (asset.isVfr) {
    return { kind: 'unsupported-vfr' };
  }

  return null;
}
