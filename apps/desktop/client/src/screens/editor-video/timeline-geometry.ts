import type {
  MusicClip,
  Scene,
  SubtitleClip,
  VideoClip,
  VideoProject,
  VoiceClip,
} from '@miaoma/video-project';

/**
 * 编辑器时间线几何：把真实工程的毫秒片段转换成秒、轨道视图与动态刻度。
 * 这里不涉及 DOM 或播放，后续播放、裁剪和吸附都复用同一套计算。
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

const TICK_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600];
const MAX_TICKS = 12;

export type EditorTrackKind = 'video' | 'voice' | 'subtitle' | 'music';

export interface TimelineTick {
  label: string;
  seconds: number;
}

export interface TimelineTrackClip {
  artist?: string;
  /** 媒体资源 id：波形按它从工程资产里取解码后的峰值。 */
  assetId: string;
  badge?: string;
  endSeconds: number;
  id: string;
  kind: EditorTrackKind;
  label: string;
  loop?: boolean;
  /** 片段引用的素材未登记在工程 assets 中：时间线显示"缺失"标记，不重新定位。 */
  missing?: boolean;
  sceneId?: string;
  /** 音乐 source 区间（毫秒）；配音/字幕没有裁剪过的 source 区间。 */
  sourceEndMs?: number;
  sourceStartMs?: number;
  startSeconds: number;
  text?: string;
  thumbnailIds?: string[];
}

export interface EditorTrackView {
  clips: TimelineTrackClip[];
  countLabel: string;
  kind: EditorTrackKind;
  title: string;
}

export interface EditorTimeline {
  durationSeconds: number;
  ticks: TimelineTick[];
  tracks: EditorTrackView[];
}

function findTrack<T extends EditorTrackKind>(
  project: VideoProject,
  kind: T,
): Extract<VideoProject['tracks'][number], { kind: T }> | undefined {
  return project.tracks.find((track) => track.kind === kind) as
    Extract<VideoProject['tracks'][number], { kind: T }> | undefined;
}

function byStart<T extends { startMs: number }>(clips: readonly T[]): T[] {
  return clips.slice().sort((left, right) => left.startMs - right.startMs);
}

function padIndex(index: number): string {
  return String(index).padStart(2, '0');
}

function sceneLabel(scene: Scene | undefined, fallbackIndex: number): string {
  return `分镜 ${padIndex(scene?.index ?? fallbackIndex)}`;
}

function seconds(ms: number): number {
  return ms / 1_000;
}

function formatShortTime(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(total / 60);

  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 工程时长以分镜时长之和为准；没有分镜的工程回退到轨道上最远的片段。
 */
export function projectDurationSeconds(project: VideoProject): number {
  const sceneMs = project.scenes.reduce((sum, scene) => sum + Math.max(0, scene.durationMs), 0);

  if (sceneMs > 0) {
    return seconds(sceneMs);
  }

  let maxEndMs = 0;

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      maxEndMs = Math.max(maxEndMs, clip.endMs);
    }
  }

  return seconds(maxEndMs);
}

export function buildTimelineTicks(durationSeconds: number): TimelineTick[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [{ label: '00:00', seconds: 0 }];
  }

  const step =
    TICK_STEPS_SECONDS.find((candidate) => durationSeconds / candidate <= MAX_TICKS) ??
    TICK_STEPS_SECONDS[TICK_STEPS_SECONDS.length - 1]!;
  const ticks: TimelineTick[] = [];

  for (let at = 0; at <= durationSeconds + 1e-9; at += step) {
    ticks.push({ label: formatShortTime(at), seconds: at });
  }

  const last = ticks[ticks.length - 1];

  if (!last || last.seconds < durationSeconds) {
    ticks.push({ label: formatShortTime(durationSeconds), seconds: durationSeconds });
  }

  return ticks;
}

function buildVideoClips(project: VideoProject, scenesById: Map<string, Scene>) {
  const track = findTrack(project, 'video');
  const assetsById = new Map(project.assets.videos.map((asset) => [asset.id, asset]));
  const registeredThumbnails = new Set(project.assets.thumbnails.map((asset) => asset.id));

  return byStart<VideoClip>(track?.clips ?? []).map((clip, index): TimelineTrackClip => {
    const scene = clip.sceneId ? scenesById.get(clip.sceneId) : undefined;
    const asset = assetsById.get(clip.assetId);
    const thumbnailIds = (asset?.thumbnailIds ?? []).filter((id) => registeredThumbnails.has(id));

    return {
      assetId: clip.assetId,
      endSeconds: seconds(clip.endMs),
      id: clip.id,
      kind: 'video',
      label: sceneLabel(scene, index + 1),
      missing: asset === undefined,
      ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
      startSeconds: seconds(clip.startMs),
      thumbnailIds,
    };
  });
}

function buildVoiceClips(project: VideoProject, scenesById: Map<string, Scene>) {
  const track = findTrack(project, 'voice');
  const assetsById = new Map(project.assets.voices.map((asset) => [asset.id, asset]));

  return byStart<VoiceClip>(track?.clips ?? []).map((clip, index): TimelineTrackClip => {
    const scene = clip.sceneId ? scenesById.get(clip.sceneId) : undefined;
    const asset = assetsById.get(clip.assetId);

    return {
      assetId: clip.assetId,
      endSeconds: seconds(clip.endMs),
      id: clip.id,
      kind: 'voice',
      label: scene ? `配音 ${padIndex(scene.index)}` : `配音 ${padIndex(index + 1)}`,
      missing: asset === undefined,
      ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
      startSeconds: seconds(clip.startMs),
      ...(asset?.isMock ? { badge: '模拟' } : {}),
    };
  });
}

function buildSubtitleClips(project: VideoProject) {
  const track = findTrack(project, 'subtitle');

  return byStart<SubtitleClip>(track?.clips ?? []).map((clip): TimelineTrackClip => ({
    assetId: clip.assetId,
    endSeconds: seconds(clip.endMs),
    id: clip.id,
    kind: 'subtitle',
    label: clip.text,
    ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
    startSeconds: seconds(clip.startMs),
    text: clip.text,
  }));
}

function buildMusicClips(project: VideoProject) {
  const track = findTrack(project, 'music');
  const assetsById = new Map(project.assets.music.map((asset) => [asset.id, asset]));

  return byStart<MusicClip>(track?.clips ?? []).map((clip): TimelineTrackClip => {
    const asset = assetsById.get(clip.assetId);

    return {
      assetId: clip.assetId,
      endSeconds: seconds(clip.endMs),
      id: clip.id,
      kind: 'music',
      label: asset?.title ?? '音乐',
      loop: clip.loop ?? false,
      missing: asset === undefined,
      sourceEndMs: clip.sourceEndMs,
      sourceStartMs: clip.sourceStartMs,
      startSeconds: seconds(clip.startMs),
      ...(asset?.artist ? { artist: asset.artist } : {}),
    };
  });
}

function countLabel(kind: EditorTrackKind, count: number): string {
  switch (kind) {
    case 'video':
      return `${count} 个分镜`;
    case 'voice':
      return `${count} 段配音`;
    case 'subtitle':
      return `${count} 条字幕`;
    case 'music':
      return count === 0 ? '未添加音乐' : `${count} 段音乐`;
  }
}

export function buildEditorTimeline(project: VideoProject): EditorTimeline {
  const scenesById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  const videoClips = buildVideoClips(project, scenesById);
  const voiceClips = buildVoiceClips(project, scenesById);
  const subtitleClips = buildSubtitleClips(project);
  const musicClips = buildMusicClips(project);
  const durationSeconds = projectDurationSeconds(project);

  return {
    durationSeconds,
    ticks: buildTimelineTicks(durationSeconds),
    tracks: [
      {
        clips: videoClips,
        countLabel: countLabel('video', project.scenes.length),
        kind: 'video',
        title: '视频 1',
      },
      {
        clips: voiceClips,
        countLabel: countLabel('voice', voiceClips.length),
        kind: 'voice',
        title: '配音',
      },
      {
        clips: subtitleClips,
        countLabel: countLabel('subtitle', subtitleClips.length),
        kind: 'subtitle',
        title: '字幕',
      },
      {
        clips: musicClips,
        countLabel: countLabel('music', musicClips.length),
        kind: 'music',
        title: '音乐',
      },
    ],
  };
}

export interface MissingMediaMarker {
  assetId: string;
  kind: 'video' | 'voice' | 'music';
  message: string;
}

const MISSING_MEDIA_LABELS: Record<MissingMediaMarker['kind'], string> = {
  music: '音乐',
  video: '视频',
  voice: '配音',
};

/**
 * 汇总工程里所有缺失素材（不依赖播放头位置），供预览层持续显示"缺失"占位；
 * 同一个素材被多个片段引用时只提示一次。
 */
export function collectMissingMedia(timeline: EditorTimeline): MissingMediaMarker[] {
  const markers = new Map<string, MissingMediaMarker>();

  for (const track of timeline.tracks) {
    if (track.kind === 'subtitle') {
      continue;
    }

    for (const clip of track.clips) {
      if (!clip.missing) {
        continue;
      }

      const key = `${track.kind}:${clip.assetId}`;

      if (!markers.has(key)) {
        markers.set(key, {
          assetId: clip.assetId,
          kind: track.kind,
          message: `${MISSING_MEDIA_LABELS[track.kind]}素材缺失：${clip.label}`,
        });
      }
    }
  }

  return [...markers.values()];
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_ZOOM;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** 滑杆 0-100 映射到 1x-8x 的线性缩放。 */
export function zoomFromSlider(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_ZOOM;
  }

  return clampZoom(MIN_ZOOM + (value / 100) * (MAX_ZOOM - MIN_ZOOM));
}

export function sliderFromZoom(zoom: number): number {
  return ((clampZoom(zoom) - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;
}
