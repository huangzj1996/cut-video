import type {
  MusicAsset,
  MusicClip,
  VideoAsset,
  VideoClip,
  VideoProject,
  VoiceAsset,
  VoiceClip,
} from '@miaoma/video-project';

/**
 * 预览媒体规划：把播放头位置翻译成“当前该播哪个视频/配音/音乐片段，
 * 以及片段内的 source 时间”。这里只做纯计算，DOM 同步在 PreviewStage。
 */

const PLAYABLE_VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4']);
const PLAYABLE_VIDEO_CODECS = new Set(['avc', 'avc1', 'h264']);
const PLAYABLE_FORMAT_HINT = '目前仅支持 H.264/AAC 的 MP4/MOV。';
/** 停在 source 末尾时回退一点：避免 video seek 到 duration 变黑，也给音频留出判停余量。 */
const SOURCE_END_GUARD_SECONDS = 0.001;

export type PreviewIssueKind =
  | 'missing-asset'
  | 'unsupported-codec'
  | 'unsupported-container'
  | 'unsupported-hdr'
  | 'unsupported-vfr';

export interface PreviewIssue {
  assetId: string;
  kind: PreviewIssueKind;
  message: string;
}

export interface PreviewVideoPlan {
  assetId: string;
  clipId: string;
  endSeconds: number;
  mediaType: 'image' | 'video';
  playbackRate: number;
  sourceEndSeconds: number;
  sourceSeconds: number;
  startSeconds: number;
}

export interface PreviewAudioPlan {
  assetId: string;
  clipId: string;
  endSeconds: number;
  isMock: boolean;
  loop: boolean;
  playbackRate: number;
  sourceEndSeconds: number;
  sourceSeconds: number;
  startSeconds: number;
  volume: number;
}

export interface PreviewMediaPlan {
  audioIssues: PreviewIssue[];
  music: PreviewAudioPlan | null;
  nextVideo: PreviewVideoPlan | null;
  video: PreviewVideoPlan | null;
  videoIssue: PreviewIssue | null;
  voice: PreviewAudioPlan | null;
}

export interface MediaErrorLike {
  code?: number;
  message?: string;
}

/**
 * 音频片段已经播完（且不循环）时应暂停元素，否则媒体会越过裁剪点继续出声。
 */
export function audioReachedSourceEnd(plan: PreviewAudioPlan): boolean {
  return !plan.loop && plan.sourceSeconds >= plan.sourceEndSeconds - SOURCE_END_GUARD_SECONDS;
}

/**
 * Chromium 的 MediaError 码翻译成可读原因；视频元素报错时用它显示占位。
 */
export function describeMediaElementError(error: MediaErrorLike | null | undefined): string {
  switch (error?.code) {
    case 4:
      return '无法加载媒体：文件缺失或格式/编码不受支持。';
    case 3:
      return '媒体解码失败，可能是不支持的编码。';
    case 2:
      return '媒体加载中断，请检查文件是否仍然可读。';
    case 1:
      return '媒体加载被中断，请重试。';
    default:
      return '媒体加载失败。';
  }
}

type ClippedMs = { endMs: number; startMs: number };

function sortedByStart<T extends ClippedMs>(clips: readonly T[]): T[] {
  return clips.slice().sort((left, right) => left.startMs - right.startMs);
}

/**
 * 查找播放头所在的片段。时间恰好停在工程末尾时保留最后一帧；
 * 超过末尾则返回 undefined。
 */
export function findClipAtSeconds<T extends ClippedMs>(
  clips: readonly T[],
  timeSeconds: number,
): T | undefined {
  if (!Number.isFinite(timeSeconds)) {
    return undefined;
  }

  const timeMs = timeSeconds * 1_000;

  for (const clip of clips) {
    if (timeMs >= clip.startMs && timeMs < clip.endMs) {
      return clip;
    }
  }

  const last = clips[clips.length - 1];

  // endMs > startMs（schema 保证），因此命中末尾即落在片段内。
  if (last && timeMs === last.endMs) {
    return last;
  }

  return undefined;
}

function lastFrameSourceSeconds(sourceEndMs: number): number {
  return Math.max(0, sourceEndMs / 1_000 - SOURCE_END_GUARD_SECONDS);
}

export function resolveVideoSourceSeconds(clip: VideoClip, timelineSeconds: number): number {
  const elapsedMs = Math.max(0, timelineSeconds * 1_000 - clip.startMs);
  const speed = clip.speed ?? 1;
  const sourceSeconds = (clip.sourceStartMs + elapsedMs * speed) / 1_000;

  return Math.min(sourceSeconds, lastFrameSourceSeconds(clip.sourceEndMs));
}

export function resolveVoiceSourceSeconds(
  clip: VoiceClip,
  asset: VoiceAsset,
  timelineSeconds: number,
): number {
  const elapsedMs = Math.max(0, timelineSeconds * 1_000 - clip.startMs);
  const speed = clip.speed ?? 1;

  return Math.min((elapsedMs * speed) / 1_000, asset.durationMs / 1_000);
}

/**
 * 音乐片段可以裁剪 source 区间并循环。循环时按区间长度取模，
 * 因此工程时间与音频 source 时间始终一一对应。
 */
export function resolveMusicSourceSeconds(clip: MusicClip, timelineSeconds: number): number {
  const elapsedMs = Math.max(0, timelineSeconds * 1_000 - clip.startMs);
  const sourceSpanMs = Math.max(1, clip.sourceEndMs - clip.sourceStartMs);

  if (clip.loop) {
    return (clip.sourceStartMs + (elapsedMs % sourceSpanMs)) / 1_000;
  }

  return Math.min(clip.sourceStartMs + elapsedMs, clip.sourceEndMs) / 1_000;
}

function extensionOf(filePath: string): string {
  const match = /\.[^./\\]+$/.exec(filePath);

  return match ? match[0].toLowerCase() : '';
}

/**
 * 判断视频素材能否直接预览。只直接支持 H.264 的 MP4/MOV；
 * VFR/HEVC/HDR 返回明确原因，让预览显示占位而不是静默黑屏。
 */
export function describeVideoIssue(asset: VideoAsset): PreviewIssue | null {
  if (asset.mediaType === 'image') {
    return null;
  }

  const extension = extensionOf(asset.path);

  if (!PLAYABLE_VIDEO_EXTENSIONS.has(extension)) {
    return {
      assetId: asset.id,
      kind: 'unsupported-container',
      message: `不支持的视频容器：${extension || '未知'}。${PLAYABLE_FORMAT_HINT}`,
    };
  }

  const codec = asset.codec?.toLowerCase();

  if (codec !== undefined && !PLAYABLE_VIDEO_CODECS.has(codec)) {
    return {
      assetId: asset.id,
      kind: 'unsupported-codec',
      message: `不支持的视频编码：${asset.codec}。${PLAYABLE_FORMAT_HINT}`,
    };
  }

  if (asset.isHdr) {
    return {
      assetId: asset.id,
      kind: 'unsupported-hdr',
      message: 'HDR 视频暂不支持直接预览，请使用 SDR 素材。',
    };
  }

  if (asset.isVfr) {
    return {
      assetId: asset.id,
      kind: 'unsupported-vfr',
      message: 'VFR（可变帧率）视频暂不支持直接预览，请使用恒定帧率素材。',
    };
  }

  return null;
}

function missingAssetIssue(assetId: string): PreviewIssue {
  return {
    assetId,
    kind: 'missing-asset',
    message: `素材缺失或未登记：${assetId}。`,
  };
}

function buildVideoPlan(
  clip: VideoClip,
  asset: VideoAsset,
  timelineSeconds: number,
): PreviewVideoPlan {
  return {
    assetId: asset.id,
    clipId: clip.id,
    endSeconds: clip.endMs / 1_000,
    mediaType: asset.mediaType,
    playbackRate: asset.mediaType === 'video' ? (clip.speed ?? 1) : 1,
    sourceEndSeconds: clip.sourceEndMs / 1_000,
    sourceSeconds:
      asset.mediaType === 'video' ? resolveVideoSourceSeconds(clip, timelineSeconds) : 0,
    startSeconds: clip.startMs / 1_000,
  };
}

function buildVoicePlan(
  clip: VoiceClip,
  asset: VoiceAsset,
  timelineSeconds: number,
): PreviewAudioPlan {
  return {
    assetId: asset.id,
    clipId: clip.id,
    endSeconds: clip.endMs / 1_000,
    isMock: asset.isMock,
    loop: false,
    playbackRate: clip.speed ?? 1,
    sourceEndSeconds: asset.durationMs / 1_000,
    sourceSeconds: resolveVoiceSourceSeconds(clip, asset, timelineSeconds),
    startSeconds: clip.startMs / 1_000,
    volume: clip.volume ?? 1,
  };
}

function buildMusicPlan(
  clip: MusicClip,
  asset: MusicAsset,
  timelineSeconds: number,
): PreviewAudioPlan {
  return {
    assetId: asset.id,
    clipId: clip.id,
    endSeconds: clip.endMs / 1_000,
    isMock: false,
    loop: clip.loop ?? false,
    playbackRate: 1,
    sourceEndSeconds: clip.sourceEndMs / 1_000,
    sourceSeconds: resolveMusicSourceSeconds(clip, timelineSeconds),
    startSeconds: clip.startMs / 1_000,
    volume: clip.volume ?? 1,
  };
}

function findTrack<T extends VideoProject['tracks'][number]['kind']>(
  project: VideoProject,
  kind: T,
): Extract<VideoProject['tracks'][number], { kind: T }> | undefined {
  return project.tracks.find((track) => track.kind === kind) as
    Extract<VideoProject['tracks'][number], { kind: T }> | undefined;
}

export function buildPreviewMediaPlan(
  project: VideoProject,
  timelineSeconds: number,
): PreviewMediaPlan {
  const videoClips = sortedByStart(findTrack(project, 'video')?.clips ?? []);
  const voiceClips = sortedByStart(findTrack(project, 'voice')?.clips ?? []);
  const musicClips = sortedByStart(findTrack(project, 'music')?.clips ?? []);
  const videosById = new Map(project.assets.videos.map((asset) => [asset.id, asset]));
  const voicesById = new Map(project.assets.voices.map((asset) => [asset.id, asset]));
  const musicById = new Map(project.assets.music.map((asset) => [asset.id, asset]));
  const audioIssues: PreviewIssue[] = [];

  const activeVideo = findClipAtSeconds(videoClips, timelineSeconds);
  let video: PreviewVideoPlan | null = null;
  let videoIssue: PreviewIssue | null = null;

  if (activeVideo) {
    const asset = videosById.get(activeVideo.assetId);

    if (!asset) {
      videoIssue = missingAssetIssue(activeVideo.assetId);
    } else {
      videoIssue = describeVideoIssue(asset);

      if (!videoIssue) {
        video = buildVideoPlan(activeVideo, asset, timelineSeconds);
      }
    }
  }

  const nextClip = activeVideo
    ? videoClips.find((clip) => clip.startMs >= activeVideo.endMs)
    : undefined;
  const nextAsset = nextClip ? videosById.get(nextClip.assetId) : undefined;
  const nextVideo =
    nextClip && nextAsset && !describeVideoIssue(nextAsset)
      ? buildVideoPlan(nextClip, nextAsset, nextClip.startMs / 1_000)
      : null;

  const activeVoice = findClipAtSeconds(voiceClips, timelineSeconds);
  let voice: PreviewAudioPlan | null = null;

  if (activeVoice) {
    const asset = voicesById.get(activeVoice.assetId);

    if (asset) {
      voice = buildVoicePlan(activeVoice, asset, timelineSeconds);
    } else {
      audioIssues.push(missingAssetIssue(activeVoice.assetId));
    }
  }

  const activeMusic = findClipAtSeconds(musicClips, timelineSeconds);
  let music: PreviewAudioPlan | null = null;

  if (activeMusic) {
    const asset = musicById.get(activeMusic.assetId);

    if (asset) {
      music = buildMusicPlan(activeMusic, asset, timelineSeconds);
    } else {
      audioIssues.push(missingAssetIssue(activeMusic.assetId));
    }
  }

  return { audioIssues, music, nextVideo, video, videoIssue, voice };
}
