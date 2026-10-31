import { SubtitleStyleSchema } from '@miaoma/video-project';
import type {
  MusicAsset,
  MusicClip,
  Scene,
  SubtitleClip,
  SubtitlePresetId,
  VideoClip,
  VideoProject,
  VoiceClip,
} from '@miaoma/video-project';

/**
 * 编辑器编辑纯函数（主接缝）。
 *
 * 时间线采用"分镜锁定"模型：视频轨以分镜为原子块，块与块首尾相接；
 * 拖动视频块即移动整个分镜，视频、配音、字幕片段一起平移。分镜时长只能
 * 通过末尾视频片段的右边缘裁剪改变，分割只在分镜内部产生 source 连续的片段。
 * 字幕只能在所属分镜内移动/裁剪/删除，音乐可以任意移动、裁剪、分割、删除并保留空隙。
 * 每次编辑后重新校验时间线不变量，破坏不变量时整次编辑被拒绝。
 */

/** 字幕/音乐片段允许的最短时长：再短就无法在时间线上稳定点选或裁剪。 */
export const MIN_CLIP_DURATION_MS = 100;

/** 新添加音乐时的默认音量；之后由面板音量滑杆覆盖。 */
export const DEFAULT_MUSIC_VOLUME = 0.6;

export type ClipEdge = 'start' | 'end';

export type EditAction =
  | {
      /** 把 `sceneId` 对应的分镜移动到新顺序中的 `targetIndex`（0 基）。 */
      type: 'reorder-scene';
      sceneId: string;
      targetIndex: number;
    }
  | {
      /** 拖动分镜末尾视频片段右边缘：负值缩短、正值延长（毫秒）。 */
      type: 'trim-video';
      clipId: string;
      deltaMs: number;
    }
  | {
      /** 在播放头处把选中的视频片段一分为二；播放头必须落在该片段内部。 */
      type: 'split-video';
      clipId: string;
      atMs: number;
    }
  | {
      /** 删除片段；视频/配音一律被拒绝，字幕/音乐用下面的专用动作。 */
      type: 'delete-clip';
      clipId: string;
    }
  | {
      type: 'add-scene';
    }
  | {
      type: 'remove-scene';
      sceneId: string;
    }
  | {
      type: 'replace-asset';
      clipId: string;
      assetId: string;
    }
  | {
      /** 在所属分镜内整体平移字幕片段，单位毫秒。 */
      type: 'move-subtitle-clip';
      clipId: string;
      deltaMs: number;
    }
  | {
      /** 裁剪字幕片段的左/右边缘；`deltaMs` 为正表示向右移动该边缘。 */
      type: 'trim-subtitle-clip';
      clipId: string;
      edge: ClipEdge;
      deltaMs: number;
    }
  | { type: 'delete-subtitle-clip'; clipId: string }
  | {
      /** 在工程时间线内整体平移音乐片段（允许产生空隙）。 */
      type: 'move-music-clip';
      clipId: string;
      deltaMs: number;
    }
  | {
      /** 裁剪音乐片段的左/右边缘，同步裁剪 source 区间（loop 片段右裁剪只改时间线）。 */
      type: 'trim-music-clip';
      clipId: string;
      edge: ClipEdge;
      deltaMs: number;
    }
  | {
      /** 在 `atMs` 处把音乐片段拆成首尾相接的两段，source 区间按播放顺序切分。 */
      type: 'split-music-clip';
      clipId: string;
      atMs: number;
    }
  | { type: 'delete-music-clip'; clipId: string }
  | {
      /** 添加/更换背景音乐：登记素材并从时间线 0 开始放一条片段，替换已有音乐。 */
      type: 'add-music';
      asset: MusicAsset;
      volume?: number;
    }
  | { type: 'remove-music' }
  | {
      /** 音乐轨的“可听”开关；只改可见性，不删除片段、音量或裁剪。 */
      type: 'set-music-visible';
      visible: boolean;
    }
  | {
      /** 把整条音乐轨的音量设置成同一值（0–1）。 */
      type: 'set-music-volume';
      volume: number;
    }
  | {
      /** 整条字幕轨的样式；只改传入的字段，应用范围是整条字幕轨。 */
      type: 'set-subtitle-style';
      presetId?: SubtitlePresetId;
      fontSize?: number;
    }
  | {
      /** 字幕轨显示开关；只改可见性，不删除片段或样式。 */
      type: 'set-subtitle-visible';
      visible: boolean;
    };

export type EditRejectionCode =
  | 'EDIT_ASSET_REPLACE_BLOCKED'
  | 'EDIT_CLIP_DELETE_UNSUPPORTED'
  | 'EDIT_CLIP_NOT_FOUND'
  | 'EDIT_CLIP_OUT_OF_BOUNDS'
  | 'EDIT_CLIP_OVERLAP'
  | 'EDIT_DELETE_BLOCKED'
  | 'EDIT_INVALID_CLIP_RANGE'
  | 'EDIT_INVALID_TARGET_INDEX'
  | 'EDIT_INVARIANT_VIOLATION'
  | 'EDIT_SCENE_ADD_BLOCKED'
  | 'EDIT_SCENE_NOT_FOUND'
  | 'EDIT_SCENE_REMOVE_BLOCKED'
  | 'EDIT_MUSIC_ASSET_INVALID'
  | 'EDIT_MUSIC_EMPTY_PROJECT'
  | 'EDIT_MUSIC_VOLUME_INVALID'
  | 'EDIT_SOURCE_ASSET_MISSING'
  | 'EDIT_SOURCE_RANGE_EXCEEDED'
  | 'EDIT_SUBTITLE_STYLE_INVALID'
  | 'EDIT_SUBTITLE_TRACK_MISSING'
  | 'EDIT_SPLIT_OUTSIDE_CLIP'
  | 'EDIT_SPLIT_TOO_CLOSE_TO_EDGE'
  | 'EDIT_TRIM_INVALID_DELTA'
  | 'EDIT_TRIM_NOT_LAST_CLIP'
  | 'EDIT_TRIM_SCENE_TOO_SHORT';

export type EditResult =
  | { changed: boolean; ok: true; project: VideoProject }
  | { code: EditRejectionCode; message: string; ok: false };

export type InvariantViolationCode =
  | 'SCENE_INDEX_MISMATCH'
  | 'SCENE_REFERENCE_MISMATCH'
  | 'VIDEO_TRACK_GAP_OR_OVERLAP'
  | 'VIDEO_TRACK_DURATION_MISMATCH'
  | 'VOICE_TRACK_GAP_OR_OVERLAP'
  | 'VOICE_TRACK_DURATION_MISMATCH'
  | 'CLIP_OUT_OF_SCENE'
  | 'SUBTITLE_OUT_OF_SCENE'
  | 'SUBTITLE_OVERLAP'
  | 'SCENE_SUBTITLE_REFERENCE_MISMATCH'
  | 'MUSIC_TRACK_OVERLAP'
  | 'MUSIC_OUT_OF_PROJECT'
  | 'MUSIC_SOURCE_RANGE_INVALID';

export interface InvariantViolation {
  code: InvariantViolationCode;
  message: string;
}

interface SceneSpan {
  endMs: number;
  startMs: number;
}

type SceneBoundClip = SubtitleClip | VideoClip | VoiceClip;

type ClippedMs = { endMs: number; startMs: number };

function orderedScenes(project: VideoProject): Scene[] {
  return project.scenes
    .slice()
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
}

/** 分镜在时间线上的绝对区间：按分镜顺序累加时长得到。 */
function sceneSpans(scenes: readonly Scene[]): Map<string, SceneSpan> {
  const spans = new Map<string, SceneSpan>();
  let cursorMs = 0;

  for (const scene of scenes) {
    const endMs = cursorMs + Math.max(0, scene.durationMs);

    spans.set(scene.id, { endMs, startMs: cursorMs });
    cursorMs = endMs;
  }

  return spans;
}

function sceneTotalMs(scenes: readonly Scene[]): number {
  return scenes.reduce((sum, scene) => sum + Math.max(0, scene.durationMs), 0);
}

function findTrack<T extends VideoProject['tracks'][number]['kind']>(
  project: VideoProject,
  kind: T,
): Extract<VideoProject['tracks'][number], { kind: T }> | undefined {
  return project.tracks.find((track) => track.kind === kind) as
    Extract<VideoProject['tracks'][number], { kind: T }> | undefined;
}

function sortedClips<T extends { startMs: number }>(clips: readonly T[]): T[] {
  return clips.slice().sort((left, right) => left.startMs - right.startMs);
}

/**
 * 片段之间不允许重叠（半开区间：首尾相接是合法的）。
 * 分镜锁定的视频/配音轨要求首尾相接，这里只负责通用的重叠判断。
 */
function clipsOverlap(left: ClippedMs, right: ClippedMs): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function findOverlappingClip<T extends ClippedMs & { id: string }>(
  clips: readonly T[],
  candidate: ClippedMs & { id: string },
): T | undefined {
  return clips.find((clip) => clip.id !== candidate.id && clipsOverlap(clip, candidate));
}

function checkContiguity(
  clips: ReadonlyArray<{ endMs: number; id: string; startMs: number }>,
  totalMs: number,
  gapCode: InvariantViolationCode,
  durationCode: InvariantViolationCode,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const ordered = sortedClips(clips);

  if (ordered.length === 0) {
    if (totalMs > 0) {
      violations.push({
        code: durationCode,
        message: `轨道为空，但工程总时长为 ${totalMs}ms。`,
      });
    }

    return violations;
  }

  const first = ordered[0];

  if (!first || first.startMs !== 0) {
    violations.push({
      code: gapCode,
      message: `轨道第一个片段应从 0ms 开始，实际为 ${first?.startMs ?? 'missing'}ms。`,
    });
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (!previous || !current) {
      continue;
    }

    if (current.startMs !== previous.endMs) {
      violations.push({
        code: gapCode,
        message: `片段 ${previous.id} 与 ${current.id} 之间${current.startMs > previous.endMs ? '有空隙' : '重叠'}。`,
      });
    }
  }

  const last = ordered[ordered.length - 1];

  if (last && last.endMs !== totalMs) {
    violations.push({
      code: durationCode,
      message: `轨道结束于 ${last.endMs}ms，工程总时长为 ${totalMs}ms。`,
    });
  }

  return violations;
}

function checkClipSpans(
  clips: ReadonlyArray<{ endMs: number; id: string; sceneId?: string; startMs: number }>,
  spans: Map<string, SceneSpan>,
  outOfSceneCode: InvariantViolationCode,
  requireSceneId: boolean,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const clip of clips) {
    if (!clip.sceneId) {
      if (requireSceneId) {
        violations.push({
          code: 'SCENE_REFERENCE_MISMATCH',
          message: `片段 ${clip.id} 缺少所属分镜。`,
        });
      }

      continue;
    }

    const span = spans.get(clip.sceneId);

    if (!span) {
      violations.push({
        code: 'SCENE_REFERENCE_MISMATCH',
        message: `片段 ${clip.id} 引用了不存在的分镜 ${clip.sceneId}。`,
      });
      continue;
    }

    if (clip.startMs < span.startMs || clip.endMs > span.endMs) {
      violations.push({
        code: outOfSceneCode,
        message: `片段 ${clip.id} 超出分镜 ${clip.sceneId} 的 ${span.startMs}-${span.endMs}ms 区间。`,
      });
    }
  }

  return violations;
}

/** 字幕/音乐这类无覆盖要求的轨道：只检查是否互相重叠。 */
function checkOverlap<T extends ClippedMs & { id: string }>(
  clips: readonly T[],
  code: InvariantViolationCode,
  label: string,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const ordered = sortedClips(clips);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (previous && current && clipsOverlap(previous, current)) {
      violations.push({
        code,
        message: `${label} ${previous.id} 与 ${current.id} 互相重叠。`,
      });
    }
  }

  return violations;
}

/** 音乐的 source 区间必须落在素材时长内，否则预览会 seek 到不存在的音频位置。 */
function checkMusicSourceRanges(project: VideoProject): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const assetsById = new Map(project.assets.music.map((asset) => [asset.id, asset]));

  for (const clip of findTrack(project, 'music')?.clips ?? []) {
    if (clip.sourceStartMs < 0 || clip.sourceEndMs <= clip.sourceStartMs) {
      violations.push({
        code: 'MUSIC_SOURCE_RANGE_INVALID',
        message: `音乐片段 ${clip.id} 的 source 区间 ${clip.sourceStartMs}-${clip.sourceEndMs}ms 无效。`,
      });
      continue;
    }

    const asset = assetsById.get(clip.assetId);

    if (asset && clip.sourceEndMs > asset.durationMs) {
      violations.push({
        code: 'MUSIC_SOURCE_RANGE_INVALID',
        message: `音乐片段 ${clip.id} 超出素材 ${asset.id} 的 ${asset.durationMs}ms 时长。`,
      });
    }
  }

  return violations;
}

/** 场景里声明的 subtitleIds 必须与字幕轨中挂在该分镜下的片段一致。 */
function checkSceneSubtitleReferences(
  project: VideoProject,
  scenes: readonly Scene[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const subtitleClips = findTrack(project, 'subtitle')?.clips ?? [];

  for (const scene of scenes) {
    const clipAssetIds = subtitleClips
      .filter((clip) => clip.sceneId === scene.id)
      .map((clip) => clip.assetId)
      .sort();
    const declaredIds = scene.subtitleIds.slice().sort();

    if (clipAssetIds.join('|') !== declaredIds.join('|')) {
      violations.push({
        code: 'SCENE_SUBTITLE_REFERENCE_MISMATCH',
        message: `分镜 ${scene.id} 的 subtitleIds 与字幕轨不一致。`,
      });
    }
  }

  return violations;
}

/**
 * 时间线不变量：视频/配音轨连续覆盖、字幕与片段不越出所属分镜、
 * 字幕/音乐互不重叠、音乐落在工程内且 source 有效、分镜序号连续、
 * 场景引用与轨道一致。编辑器每次编辑后都依赖这套检查。
 */
export function findInvariantViolations(project: VideoProject): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const scenes = orderedScenes(project);
  const spans = sceneSpans(scenes);
  const totalMs = sceneTotalMs(scenes);

  scenes.forEach((scene, position) => {
    if (scene.index !== position + 1) {
      violations.push({
        code: 'SCENE_INDEX_MISMATCH',
        message: `分镜 ${scene.id} 的 index 应为 ${position + 1}，实际为 ${scene.index}。`,
      });
    }
  });

  const videoClips = findTrack(project, 'video')?.clips ?? [];
  const voiceClips = findTrack(project, 'voice')?.clips ?? [];
  const subtitleClips = findTrack(project, 'subtitle')?.clips ?? [];
  const musicClips = findTrack(project, 'music')?.clips ?? [];

  violations.push(
    ...checkContiguity(
      videoClips,
      totalMs,
      'VIDEO_TRACK_GAP_OR_OVERLAP',
      'VIDEO_TRACK_DURATION_MISMATCH',
    ),
    ...checkContiguity(
      voiceClips,
      totalMs,
      'VOICE_TRACK_GAP_OR_OVERLAP',
      'VOICE_TRACK_DURATION_MISMATCH',
    ),
    ...checkClipSpans(videoClips, spans, 'CLIP_OUT_OF_SCENE', true),
    ...checkClipSpans(voiceClips, spans, 'CLIP_OUT_OF_SCENE', true),
    ...checkClipSpans(subtitleClips, spans, 'SUBTITLE_OUT_OF_SCENE', false),
    ...checkOverlap(subtitleClips, 'SUBTITLE_OVERLAP', '字幕片段'),
    ...checkOverlap(musicClips, 'MUSIC_TRACK_OVERLAP', '音乐片段'),
    ...checkMusicSourceRanges(project),
    ...checkSceneSubtitleReferences(project, scenes),
  );

  if (totalMs > 0) {
    for (const clip of musicClips) {
      if (clip.startMs < 0 || clip.endMs > totalMs) {
        violations.push({
          code: 'MUSIC_OUT_OF_PROJECT',
          message: `音乐片段 ${clip.id} 落在工程 0-${totalMs}ms 之外。`,
        });
      }
    }
  }

  const videoSceneIds = new Set(videoClips.map((clip) => clip.sceneId));
  const voiceSceneIds = new Set(voiceClips.map((clip) => clip.sceneId));

  for (const scene of scenes) {
    if (!videoSceneIds.has(scene.id)) {
      violations.push({
        code: 'SCENE_REFERENCE_MISMATCH',
        message: `分镜 ${scene.id} 没有对应的视频片段。`,
      });
    }

    if (!voiceSceneIds.has(scene.id)) {
      violations.push({
        code: 'SCENE_REFERENCE_MISMATCH',
        message: `分镜 ${scene.id} 没有对应的配音片段。`,
      });
    }
  }

  return violations;
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);

  if (moved === undefined) {
    return next;
  }

  next.splice(to, 0, moved);

  return next;
}

function shiftClip<T extends ClippedMs>(clip: T, deltaMs: number): T {
  if (deltaMs === 0) {
    return clip;
  }

  return {
    ...clip,
    endMs: clip.endMs + deltaMs,
    startMs: clip.startMs + deltaMs,
  };
}

function shiftTrackClips<T extends SceneBoundClip>(
  clips: readonly T[],
  deltas: Map<string, number>,
): T[] {
  return sortedClips(
    clips.map((clip) => {
      const delta = clip.sceneId ? deltas.get(clip.sceneId) : undefined;

      return delta === undefined ? clip : shiftClip(clip, delta);
    }),
  );
}

/** 场景锁定的排序：只有带 sceneId 的轨道片段跟随分镜平移，音乐轨不动。 */
function reorderTracks(project: VideoProject, deltas: Map<string, number>): VideoProject['tracks'] {
  return project.tracks.map((track): VideoProject['tracks'][number] => {
    switch (track.kind) {
      case 'video':
        return { ...track, clips: shiftTrackClips(track.clips, deltas) };
      case 'voice':
        return { ...track, clips: shiftTrackClips(track.clips, deltas) };
      case 'subtitle':
        return { ...track, clips: shiftTrackClips(track.clips, deltas) };
      case 'music':
        return track;
    }
  });
}

function reject(code: EditRejectionCode, message: string): EditResult {
  return { code, message, ok: false };
}

/** 每次编辑后统一校验时间线不变量；返回 null 表示文档可以提交。 */
function rejectOnInvariantViolation(nextProject: VideoProject): EditResult | null {
  const violations = findInvariantViolations(nextProject);

  if (violations.length === 0) {
    return null;
  }

  const [first] = violations;

  return reject(
    'EDIT_INVARIANT_VIOLATION',
    `编辑会破坏时间线：${first?.message ?? '未知不变量'}。`,
  );
}

/**
 * 所有编辑的统一出口：跑一遍不变量，通过后才返回新文档。
 * 拒绝时调用方看到的仍是原始文档（不会产生半成品）。
 */
function commitEdit(project: VideoProject, nextProject: VideoProject): EditResult {
  const violation = rejectOnInvariantViolation(nextProject);

  if (violation) {
    return violation;
  }

  return { changed: true, ok: true, project: nextProject };
}

/** 用新轨道替换同 kind 的轨道，保持其他轨道引用不变。 */
function replaceTracks(
  project: VideoProject,
  track: VideoProject['tracks'][number],
): VideoProject['tracks'] {
  return project.tracks.map((candidate) => (candidate.kind === track.kind ? track : candidate));
}

function isDeltaValid(deltaMs: number): boolean {
  return Number.isSafeInteger(deltaMs);
}

function rejectInvalidDelta(): EditResult {
  return reject('EDIT_INVALID_CLIP_RANGE', '编辑步长无效。');
}

/** 分镜顺序不变、只有时长变化时，把片段按所属分镜的新起点平移。 */
function rebaseSceneBoundClips<T extends SceneBoundClip>(
  clips: readonly T[],
  oldSpans: Map<string, SceneSpan>,
  newSpans: Map<string, SceneSpan>,
): T[] {
  return sortedClips(
    clips.map((clip) => {
      if (!clip.sceneId) {
        return clip;
      }

      const previous = oldSpans.get(clip.sceneId);
      const next = newSpans.get(clip.sceneId);

      return previous && next ? shiftClip(clip, next.startMs - previous.startMs) : clip;
    }),
  );
}

/**
 * 分镜时长变化后，把超出新工程末尾的音乐片段截断或丢弃。
 * 音乐不跟随分镜，但工程变短时不能保留时间线之外的配乐，否则不变量失败。
 */
function clampMusicToDuration(project: VideoProject, totalMs: number): MusicClip[] {
  const nextClips: MusicClip[] = [];

  for (const clip of findTrack(project, 'music')?.clips ?? []) {
    if (clip.startMs >= totalMs) {
      continue;
    }

    if (clip.endMs <= totalMs) {
      nextClips.push(clip);
      continue;
    }

    nextClips.push({
      ...clip,
      endMs: totalMs,
      // 循环片段只改时间线长度；非循环片段同步截断 source 区间。
      sourceEndMs: clip.loop
        ? clip.sourceEndMs
        : Math.min(clip.sourceEndMs, clip.sourceStartMs + (totalMs - clip.startMs)),
    });
  }

  return sortedClips(nextClips);
}

/**
 * 视频右边缘裁剪：分镜锁定模型下，只有分镜末尾的视频片段能改变分镜时长。
 * 缩短时截断配音尾部、裁剪或丢弃越界字幕、后续分镜前移；同时同步分镜的
 * subtitleIds 并按新总时长截断音乐。延长时配音片段延伸到新结尾（音频播完后
 * 为静音），source 不足则拒绝。
 */
function trimVideoClip(project: VideoProject, clipId: string, deltaMs: number): EditResult {
  if (!Number.isInteger(deltaMs) || deltaMs === 0) {
    return reject('EDIT_TRIM_INVALID_DELTA', '裁剪量必须是非零整数毫秒。');
  }

  const oldScenes = orderedScenes(project);
  const oldSpans = sceneSpans(oldScenes);
  const videoClips = findTrack(project, 'video')?.clips ?? [];
  const clip = videoClips.find((candidate) => candidate.id === clipId);

  if (!clip || !clip.sceneId) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要裁剪的视频片段。');
  }

  const scene = oldScenes.find((candidate) => candidate.id === clip.sceneId);
  const span = scene ? oldSpans.get(scene.id) : undefined;

  if (!scene || !span) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要裁剪的分镜。');
  }

  if (clip.endMs !== span.endMs) {
    return reject('EDIT_TRIM_NOT_LAST_CLIP', '只能裁剪分镜末尾的视频片段。');
  }

  const nextDurationMs = scene.durationMs + deltaMs;

  if (nextDurationMs <= 0) {
    return reject('EDIT_TRIM_SCENE_TOO_SHORT', '分镜时长不能缩短到 0ms。');
  }

  const speed = clip.speed ?? 1;
  const nextSourceEndMs = clip.sourceEndMs + Math.round(deltaMs * speed);

  if (nextSourceEndMs <= clip.sourceStartMs) {
    return reject('EDIT_TRIM_SCENE_TOO_SHORT', '裁剪后视频片段不能为空。');
  }

  if (deltaMs > 0) {
    const asset = project.assets.videos.find((candidate) => candidate.id === clip.assetId);

    if (!asset) {
      return reject('EDIT_SOURCE_ASSET_MISSING', '视频素材缺失，无法延长该分镜。');
    }

    if (nextSourceEndMs > asset.durationMs) {
      return reject('EDIT_SOURCE_RANGE_EXCEEDED', '视频素材长度不足，无法再延长该分镜。');
    }
  }

  const nextScenes = oldScenes.map((candidate) =>
    candidate.id === scene.id ? { ...candidate, durationMs: nextDurationMs } : candidate,
  );
  const nextSpans = sceneSpans(nextScenes);
  const nextSceneEndMs = span.startMs + nextDurationMs;
  const voiceClips = findTrack(project, 'voice')?.clips ?? [];
  const subtitleClips = findTrack(project, 'subtitle')?.clips ?? [];
  const nextVideoClips = rebaseSceneBoundClips(videoClips, oldSpans, nextSpans).map((candidate) =>
    candidate.id === clip.id
      ? { ...candidate, endMs: nextSceneEndMs, sourceEndMs: nextSourceEndMs }
      : candidate,
  );
  const nextVoiceClips = rebaseSceneBoundClips(voiceClips, oldSpans, nextSpans).map((candidate) =>
    candidate.sceneId === scene.id && candidate.endMs === span.endMs
      ? { ...candidate, endMs: nextSceneEndMs }
      : candidate,
  );
  const nextSubtitleClips: SubtitleClip[] = [];

  for (const candidate of rebaseSceneBoundClips(subtitleClips, oldSpans, nextSpans)) {
    if (candidate.sceneId !== scene.id) {
      nextSubtitleClips.push(candidate);
      continue;
    }

    // 越界字幕：整条落在新结尾之后的丢弃，跨越新结尾的裁剪到新结尾。
    if (candidate.startMs >= nextSceneEndMs) {
      continue;
    }

    nextSubtitleClips.push({ ...candidate, endMs: Math.min(candidate.endMs, nextSceneEndMs) });
  }

  // 字幕被丢弃后要同步分镜的 subtitleIds，否则场景引用与字幕轨不一致。
  const remainingSubtitleAssetIds = new Set(
    nextSubtitleClips
      .filter((candidate) => candidate.sceneId === scene.id)
      .map((candidate) => candidate.assetId),
  );
  const nextScenesWithSubtitleRefs = nextScenes.map((candidate) =>
    candidate.id === scene.id
      ? {
          ...candidate,
          subtitleIds: candidate.subtitleIds.filter((assetId) =>
            remainingSubtitleAssetIds.has(assetId),
          ),
        }
      : candidate,
  );
  const nextTotalMs = sceneTotalMs(nextScenesWithSubtitleRefs);
  const nextMusicClips = clampMusicToDuration(project, nextTotalMs);
  const nextProject: VideoProject = {
    ...project,
    scenes: nextScenesWithSubtitleRefs,
    tracks: project.tracks.map((track): VideoProject['tracks'][number] => {
      switch (track.kind) {
        case 'video':
          return { ...track, clips: sortedClips(nextVideoClips) };
        case 'voice':
          return { ...track, clips: sortedClips(nextVoiceClips) };
        case 'subtitle':
          return { ...track, clips: sortedClips(nextSubtitleClips) };
        case 'music':
          return { ...track, clips: nextMusicClips };
      }
    }),
  };

  return commitEdit(project, nextProject);
}

function findClipById(project: VideoProject, clipId: string) {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);

    if (clip) {
      return clip;
    }
  }

  return undefined;
}

function uniqueClipId(project: VideoProject, baseId: string): string {
  const existingIds = new Set(
    project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
  );
  let candidate = baseId;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/** 在播放头处把选中的视频片段一分为二：两段共享切点，source 区间首尾相接。 */
function splitVideoClip(project: VideoProject, clipId: string, atMs: number): EditResult {
  if (!Number.isInteger(atMs)) {
    return reject('EDIT_SPLIT_OUTSIDE_CLIP', '播放头不在视频片段内部，无法分割。');
  }

  const videoClips = findTrack(project, 'video')?.clips ?? [];
  const target = videoClips.find((clip) => clip.id === clipId);

  if (!target) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到选中的视频片段。');
  }

  // 播放头必须落在选中的这一片段内部；不允许切到播放头下的其他片段。
  if (!(target.startMs < atMs && atMs < target.endMs)) {
    return reject('EDIT_SPLIT_OUTSIDE_CLIP', '播放头不在选中的视频片段内部，无法分割。');
  }

  const speed = target.speed ?? 1;
  const sourceSplitMs = target.sourceStartMs + Math.round((atMs - target.startMs) * speed);

  if (sourceSplitMs <= target.sourceStartMs || sourceSplitMs >= target.sourceEndMs) {
    return reject('EDIT_SPLIT_TOO_CLOSE_TO_EDGE', '距离视频片段边缘太近，无法分割。');
  }

  const first: VideoClip = { ...target, endMs: atMs, sourceEndMs: sourceSplitMs };
  const second: VideoClip = {
    ...target,
    id: uniqueClipId(project, `${target.id}--${atMs}`),
    sourceStartMs: sourceSplitMs,
    startMs: atMs,
  };
  const nextVideoClips = sortedClips(
    videoClips.map((clip) => (clip.id === target.id ? first : clip)).concat(second),
  );
  const nextProject: VideoProject = {
    ...project,
    tracks: project.tracks.map((track): VideoProject['tracks'][number] =>
      track.kind === 'video' ? { ...track, clips: nextVideoClips } : track,
    ),
  };

  return commitEdit(project, nextProject);
}

function subtitleSceneSpan(scenes: readonly Scene[], clip: SubtitleClip): SceneSpan | null {
  if (!clip.sceneId) {
    return null;
  }

  return sceneSpans(scenes).get(clip.sceneId) ?? null;
}

function moveSubtitleClip(project: VideoProject, clipId: string, deltaMs: number): EditResult {
  if (!isDeltaValid(deltaMs)) {
    return rejectInvalidDelta();
  }

  if (deltaMs === 0) {
    return { changed: false, ok: true, project };
  }

  const track = findTrack(project, 'subtitle');
  const clip = track?.clips.find((candidate) => candidate.id === clipId);

  if (!track || !clip) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要移动的字幕片段。');
  }

  const scenes = orderedScenes(project);
  const span = subtitleSceneSpan(scenes, clip);

  if (!span) {
    return reject('EDIT_INVARIANT_VIOLATION', '字幕片段没有有效的所属分镜。');
  }

  const next = { id: clip.id, startMs: clip.startMs + deltaMs, endMs: clip.endMs + deltaMs };

  if (next.startMs < span.startMs || next.endMs > span.endMs) {
    return reject('EDIT_CLIP_OUT_OF_BOUNDS', '字幕不能跨出所属分镜。');
  }

  if (findOverlappingClip(track.clips, next)) {
    return reject('EDIT_CLIP_OVERLAP', '字幕片段不能互相重叠。');
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: sortedClips(
        track.clips.map((candidate) =>
          candidate.id === clip.id ? { ...candidate, ...next } : candidate,
        ),
      ),
    }),
  });
}

function trimSubtitleClip(
  project: VideoProject,
  clipId: string,
  edge: ClipEdge,
  deltaMs: number,
): EditResult {
  if (!isDeltaValid(deltaMs)) {
    return rejectInvalidDelta();
  }

  if (deltaMs === 0) {
    return { changed: false, ok: true, project };
  }

  const track = findTrack(project, 'subtitle');
  const clip = track?.clips.find((candidate) => candidate.id === clipId);

  if (!track || !clip) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要裁剪的字幕片段。');
  }

  const scenes = orderedScenes(project);
  const span = subtitleSceneSpan(scenes, clip);

  if (!span) {
    return reject('EDIT_INVARIANT_VIOLATION', '字幕片段没有有效的所属分镜。');
  }

  const next =
    edge === 'start'
      ? { id: clip.id, startMs: clip.startMs + deltaMs, endMs: clip.endMs }
      : { id: clip.id, startMs: clip.startMs, endMs: clip.endMs + deltaMs };

  if (next.endMs - next.startMs < MIN_CLIP_DURATION_MS) {
    return reject('EDIT_INVALID_CLIP_RANGE', `字幕片段至少需要 ${MIN_CLIP_DURATION_MS}ms。`);
  }

  if (next.startMs < span.startMs || next.endMs > span.endMs) {
    return reject('EDIT_CLIP_OUT_OF_BOUNDS', '字幕不能跨出所属分镜。');
  }

  if (findOverlappingClip(track.clips, next)) {
    return reject('EDIT_CLIP_OVERLAP', '字幕片段不能互相重叠。');
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: sortedClips(
        track.clips.map((candidate) =>
          candidate.id === clip.id ? { ...candidate, ...next } : candidate,
        ),
      ),
    }),
  });
}

/** 删除字幕片段时同步场景上的 subtitleIds，避免场景还引用已删除的字幕。 */
function deleteSubtitleClip(project: VideoProject, clipId: string): EditResult {
  const track = findTrack(project, 'subtitle');
  const clip = track?.clips.find((candidate) => candidate.id === clipId);

  if (!track || !clip) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要删除的字幕片段。');
  }

  const remaining = track.clips.filter((candidate) => candidate.id !== clip.id);
  const remainingSceneAssetIds = new Set(
    remaining.filter((candidate) => candidate.sceneId === clip.sceneId).map((c) => c.assetId),
  );
  const scenes = project.scenes.map((scene) =>
    scene.id === clip.sceneId
      ? {
          ...scene,
          subtitleIds: scene.subtitleIds.filter((assetId) => remainingSceneAssetIds.has(assetId)),
        }
      : scene,
  );

  return commitEdit(project, {
    ...project,
    scenes,
    tracks: replaceTracks(project, { ...track, clips: remaining }),
  });
}

function moveMusicClip(project: VideoProject, clipId: string, deltaMs: number): EditResult {
  if (!isDeltaValid(deltaMs)) {
    return rejectInvalidDelta();
  }

  if (deltaMs === 0) {
    return { changed: false, ok: true, project };
  }

  const track = findTrack(project, 'music');
  const clip = track?.clips.find((candidate) => candidate.id === clipId);

  if (!track || !clip) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要移动的音乐片段。');
  }

  const totalMs = sceneTotalMs(orderedScenes(project));
  const next = {
    id: clip.id,
    startMs: clip.startMs + deltaMs,
    endMs: clip.endMs + deltaMs,
  };

  if (next.startMs < 0 || next.endMs > totalMs) {
    return reject('EDIT_CLIP_OUT_OF_BOUNDS', `音乐片段必须落在工程 0-${totalMs}ms 范围内。`);
  }

  if (findOverlappingClip(track.clips, next)) {
    return reject('EDIT_CLIP_OVERLAP', '音乐片段不能互相重叠；可以先留出空隙。');
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: sortedClips(
        track.clips.map((candidate) =>
          candidate.id === clip.id ? { ...candidate, ...next } : candidate,
        ),
      ),
    }),
  });
}

function trimMusicClip(
  project: VideoProject,
  clipId: string,
  edge: ClipEdge,
  deltaMs: number,
): EditResult {
  if (!isDeltaValid(deltaMs)) {
    return rejectInvalidDelta();
  }

  if (deltaMs === 0) {
    return { changed: false, ok: true, project };
  }

  const track = findTrack(project, 'music');
  const clip = track?.clips.find((candidate) => candidate.id === clipId);

  if (!track || !clip) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要裁剪的音乐片段。');
  }

  const totalMs = sceneTotalMs(orderedScenes(project));
  const asset = project.assets.music.find((candidate) => candidate.id === clip.assetId);
  const next =
    edge === 'start'
      ? {
          ...clip,
          startMs: clip.startMs + deltaMs,
          sourceStartMs: clip.sourceStartMs + deltaMs,
        }
      : {
          ...clip,
          endMs: clip.endMs + deltaMs,
          // 循环片段的右边缘只是重复次数变化，source 窗口保持不变。
          sourceEndMs: clip.loop ? clip.sourceEndMs : clip.sourceEndMs + deltaMs,
        };

  if (next.endMs - next.startMs < MIN_CLIP_DURATION_MS) {
    return reject('EDIT_INVALID_CLIP_RANGE', `音乐片段至少需要 ${MIN_CLIP_DURATION_MS}ms。`);
  }

  if (next.startMs < 0 || next.endMs > totalMs) {
    return reject('EDIT_CLIP_OUT_OF_BOUNDS', `音乐片段必须落在工程 0-${totalMs}ms 范围内。`);
  }

  if (next.sourceStartMs < 0) {
    return reject('EDIT_INVALID_CLIP_RANGE', '裁剪超出音频素材起点。');
  }

  if (next.sourceEndMs - next.sourceStartMs < MIN_CLIP_DURATION_MS) {
    return reject('EDIT_INVALID_CLIP_RANGE', `音乐的音频区间至少需要 ${MIN_CLIP_DURATION_MS}ms。`);
  }

  if (asset && next.sourceEndMs > asset.durationMs) {
    return reject(
      'EDIT_INVALID_CLIP_RANGE',
      `音乐素材只有 ${asset.durationMs}ms，无法再向右延长。`,
    );
  }

  if (findOverlappingClip(track.clips, next)) {
    return reject('EDIT_CLIP_OVERLAP', '音乐片段不能互相重叠。');
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: sortedClips(
        track.clips.map((candidate) => (candidate.id === clip.id ? next : candidate)),
      ),
    }),
  });
}

function uniqueTakenId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;

  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

/**
 * 在 `atMs` 处拆分音乐片段。
 *
 * 非循环片段：source 区间在分割点处一分为二，两段首尾相接地连续播放。
 * 循环片段：右段从分割瞬间的循环相位开始，因此右段的 source 窗口是
 * `[相位, sourceEnd)`；跨过素材末尾后从相位重新循环。这是单 source 窗口模型下
 * 保证"分割瞬间不断音"的取舍，报告里已标注。
 */
function splitMusicClip(project: VideoProject, clipId: string, atMs: number): EditResult {
  if (!Number.isSafeInteger(atMs)) {
    return reject('EDIT_INVALID_CLIP_RANGE', '分割位置无效。');
  }

  const track = findTrack(project, 'music');
  const clip = track?.clips.find((candidate) => candidate.id === clipId);

  if (!track || !clip) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要分割的音乐片段。');
  }

  if (atMs - clip.startMs < MIN_CLIP_DURATION_MS || clip.endMs - atMs < MIN_CLIP_DURATION_MS) {
    return reject('EDIT_INVALID_CLIP_RANGE', `分割点两侧都需要至少 ${MIN_CLIP_DURATION_MS}ms。`);
  }

  const rightId = uniqueTakenId(`${clip.id}-${atMs}`, new Set(track.clips.map((c) => c.id)));
  let left: MusicClip;
  let right: MusicClip;

  if (clip.loop) {
    const spanMs = clip.sourceEndMs - clip.sourceStartMs;
    const phaseMs = clip.sourceStartMs + ((atMs - clip.startMs) % spanMs);

    left = { ...clip, endMs: atMs };
    right = { ...clip, id: rightId, startMs: atMs, sourceStartMs: phaseMs };
  } else {
    const sourceAtSplitMs = clip.sourceStartMs + (atMs - clip.startMs);

    if (sourceAtSplitMs <= clip.sourceStartMs || sourceAtSplitMs >= clip.sourceEndMs) {
      return reject('EDIT_INVALID_CLIP_RANGE', '分割点超出了这段音乐的有效音频区间。');
    }

    left = { ...clip, endMs: atMs, sourceEndMs: sourceAtSplitMs };
    right = { ...clip, id: rightId, startMs: atMs, sourceStartMs: sourceAtSplitMs };
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: sortedClips(
        track.clips.flatMap((candidate) =>
          candidate.id === clip.id ? [left, right] : [candidate],
        ),
      ),
    }),
  });
}

function deleteMusicClip(project: VideoProject, clipId: string): EditResult {
  const track = findTrack(project, 'music');

  if (!track || !track.clips.some((candidate) => candidate.id === clipId)) {
    return reject('EDIT_CLIP_NOT_FOUND', '找不到要删除的音乐片段。');
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: track.clips.filter((candidate) => candidate.id !== clipId),
    }),
  });
}

function isValidMusicVolume(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** 用新的片段替换音乐轨；工程缺少音乐轨时补一条，并让新添加的音乐重新可听。 */
function musicTrackWithClips(project: VideoProject, clips: MusicClip[]): VideoProject['tracks'] {
  if (findTrack(project, 'music')) {
    return project.tracks.map((track): VideoProject['tracks'][number] =>
      track.kind === 'music' ? { ...track, clips, visible: true } : track,
    );
  }

  return [...project.tracks, { clips, id: 'track-music', kind: 'music' }];
}

/**
 * 添加/更换背景音乐：一条从 0 开始、长度取“素材时长与工程总时长较小者”的片段，
 * 不循环铺满。已有音乐时同一次编辑内替换，旧素材登记一并清理。
 */
function addMusicClip(
  project: VideoProject,
  asset: MusicAsset,
  requestedVolume: number | undefined,
): EditResult {
  const totalMs = sceneTotalMs(orderedScenes(project));

  if (totalMs <= 0) {
    return reject('EDIT_MUSIC_EMPTY_PROJECT', '工程还没有时长，无法添加背景音乐。');
  }

  if (!asset.id || !asset.path || !Number.isSafeInteger(asset.durationMs)) {
    return reject('EDIT_MUSIC_ASSET_INVALID', '音乐素材信息不完整。');
  }

  if (asset.durationMs < MIN_CLIP_DURATION_MS) {
    return reject('EDIT_MUSIC_ASSET_INVALID', `音乐素材至少需要 ${MIN_CLIP_DURATION_MS}ms。`);
  }

  if (project.assets.music.some((candidate) => candidate.id === asset.id)) {
    return reject('EDIT_MUSIC_ASSET_INVALID', '音乐素材 ID 与工程中已有素材重复。');
  }

  const clipDurationMs = Math.min(asset.durationMs, totalMs);

  if (clipDurationMs < MIN_CLIP_DURATION_MS) {
    return reject('EDIT_INVALID_CLIP_RANGE', `音乐片段至少需要 ${MIN_CLIP_DURATION_MS}ms。`);
  }

  const existingVolume = findTrack(project, 'music')?.clips[0]?.volume;
  const volume = requestedVolume ?? existingVolume ?? DEFAULT_MUSIC_VOLUME;

  if (!isValidMusicVolume(volume)) {
    return reject('EDIT_MUSIC_VOLUME_INVALID', '音乐音量必须在 0 到 1 之间。');
  }

  const clip: MusicClip = {
    assetId: asset.id,
    endMs: clipDurationMs,
    id: uniqueClipId(project, `clip-music-${asset.id}`),
    kind: 'music',
    loop: false,
    sourceEndMs: clipDurationMs,
    sourceStartMs: 0,
    startMs: 0,
    volume,
  };

  return commitEdit(project, {
    ...project,
    assets: { ...project.assets, music: [asset] },
    tracks: musicTrackWithClips(project, [clip]),
  });
}

function removeMusic(project: VideoProject): EditResult {
  const track = findTrack(project, 'music');
  const hasClips = (track?.clips.length ?? 0) > 0;

  if (!hasClips && project.assets.music.length === 0) {
    return { changed: false, ok: true, project };
  }

  return commitEdit(project, {
    ...project,
    assets: { ...project.assets, music: [] },
    tracks: track
      ? project.tracks.map((candidate): VideoProject['tracks'][number] =>
          candidate.kind === 'music' ? { ...candidate, clips: [] } : candidate,
        )
      : project.tracks,
  });
}

function setMusicVisible(project: VideoProject, visible: boolean): EditResult {
  const track = findTrack(project, 'music');

  if (!track || track.clips.length === 0) {
    return reject('EDIT_CLIP_NOT_FOUND', '当前没有可开关的背景音乐。');
  }

  if ((track.visible ?? true) === visible) {
    return { changed: false, ok: true, project };
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, { ...track, visible }),
  });
}

function setMusicVolume(project: VideoProject, volume: number): EditResult {
  if (!isValidMusicVolume(volume)) {
    return reject('EDIT_MUSIC_VOLUME_INVALID', '音乐音量必须在 0 到 1 之间。');
  }

  const track = findTrack(project, 'music');

  if (!track || track.clips.length === 0) {
    return reject('EDIT_CLIP_NOT_FOUND', '当前没有可调整音量的背景音乐。');
  }

  if (track.clips.every((clip) => (clip.volume ?? 1) === volume)) {
    return { changed: false, ok: true, project };
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, {
      ...track,
      clips: track.clips.map((clip) => ({ ...clip, volume })),
    }),
  });
}

/**
 * 字幕样式是轨道级设置：所有字幕片段共用同一份颜色/描边/字号，
 * 面板一改，预览叠层（读 track.style）立即跟着变。
 */
function setSubtitleStyle(
  project: VideoProject,
  presetId: SubtitlePresetId | undefined,
  fontSize: number | undefined,
): EditResult {
  const track = findTrack(project, 'subtitle');

  if (!track) {
    return reject('EDIT_SUBTITLE_TRACK_MISSING', '当前工程没有字幕轨。');
  }

  if (presetId === undefined && fontSize === undefined) {
    return { changed: false, ok: true, project };
  }

  const nextStyle = {
    fontSize: fontSize ?? track.style.fontSize,
    presetId: presetId ?? track.style.presetId,
  };
  const parsed = SubtitleStyleSchema.safeParse(nextStyle);

  if (!parsed.success) {
    return reject(
      'EDIT_SUBTITLE_STYLE_INVALID',
      '字幕样式无效：字号需为 24–72 的整数，样式必须是预设之一。',
    );
  }

  if (
    parsed.data.fontSize === track.style.fontSize &&
    parsed.data.presetId === track.style.presetId
  ) {
    return { changed: false, ok: true, project };
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, { ...track, style: parsed.data }),
  });
}

function setSubtitleVisible(project: VideoProject, visible: boolean): EditResult {
  const track = findTrack(project, 'subtitle');

  if (!track) {
    return reject('EDIT_SUBTITLE_TRACK_MISSING', '当前工程没有字幕轨。');
  }

  if (track.visible === visible) {
    return { changed: false, ok: true, project };
  }

  return commitEdit(project, {
    ...project,
    tracks: replaceTracks(project, { ...track, visible }),
  });
}

function reorderScene(
  project: VideoProject,
  action: Extract<EditAction, { type: 'reorder-scene' }>,
): EditResult {
  const scenes = orderedScenes(project);
  const from = scenes.findIndex((scene) => scene.id === action.sceneId);

  if (from < 0) {
    return reject('EDIT_SCENE_NOT_FOUND', '找不到要移动的分镜。');
  }

  if (
    !Number.isInteger(action.targetIndex) ||
    action.targetIndex < 0 ||
    action.targetIndex >= scenes.length
  ) {
    return reject('EDIT_INVALID_TARGET_INDEX', '目标位置无效。');
  }

  if (from === action.targetIndex) {
    return { changed: false, ok: true, project };
  }

  const nextScenes = moveItem(scenes, from, action.targetIndex).map((scene, position) => ({
    ...scene,
    index: position + 1,
  }));
  const previousSpans = sceneSpans(scenes);
  const nextSpans = sceneSpans(nextScenes);
  const deltas = new Map<string, number>();

  for (const scene of nextScenes) {
    const previous = previousSpans.get(scene.id);
    const next = nextSpans.get(scene.id);

    if (previous && next) {
      deltas.set(scene.id, next.startMs - previous.startMs);
    }
  }

  return commitEdit(project, {
    ...project,
    scenes: nextScenes,
    tracks: reorderTracks(project, deltas),
  });
}

/**
 * 应用一次编辑：成功返回新文档；拒绝时返回错误码和中文提示，且不修改原文档。
 * 调用方（会话 reducer）负责 dirty、撤销栈和只读判断。
 */
export function applyEdit(project: VideoProject, action: EditAction): EditResult {
  switch (action.type) {
    case 'reorder-scene':
      return reorderScene(project, action);

    case 'trim-video':
      return trimVideoClip(project, action.clipId, action.deltaMs);

    case 'split-video':
      return splitVideoClip(project, action.clipId, action.atMs);

    case 'delete-clip': {
      const clip = findClipById(project, action.clipId);

      if (!clip) {
        return reject('EDIT_CLIP_NOT_FOUND', '找不到要删除的片段。');
      }

      // 视频/配音跟随分镜，是原子块；删除会让视频覆盖或配音轨长度失效。
      if (clip.kind === 'video' || clip.kind === 'voice') {
        return reject('EDIT_DELETE_BLOCKED', '视频和配音片段不能删除；请回到创作消息页调整分镜。');
      }

      return reject('EDIT_CLIP_DELETE_UNSUPPORTED', '字幕和音乐片段请使用各自的删除动作。');
    }

    case 'add-scene':
      return reject('EDIT_SCENE_ADD_BLOCKED', '编辑器不支持新增分镜；请回到创作消息页重新生成。');

    case 'remove-scene':
      return reject(
        'EDIT_SCENE_REMOVE_BLOCKED',
        '编辑器不支持删除分镜；请回到创作消息页重新生成。',
      );

    case 'replace-asset':
      return reject('EDIT_ASSET_REPLACE_BLOCKED', '暂不支持替换素材；请回到创作消息页重新生成。');

    case 'move-subtitle-clip':
      return moveSubtitleClip(project, action.clipId, action.deltaMs);

    case 'trim-subtitle-clip':
      return trimSubtitleClip(project, action.clipId, action.edge, action.deltaMs);

    case 'delete-subtitle-clip':
      return deleteSubtitleClip(project, action.clipId);

    case 'move-music-clip':
      return moveMusicClip(project, action.clipId, action.deltaMs);

    case 'trim-music-clip':
      return trimMusicClip(project, action.clipId, action.edge, action.deltaMs);

    case 'split-music-clip':
      return splitMusicClip(project, action.clipId, action.atMs);

    case 'delete-music-clip':
      return deleteMusicClip(project, action.clipId);

    case 'add-music':
      return addMusicClip(project, action.asset, action.volume);

    case 'remove-music':
      return removeMusic(project);

    case 'set-music-visible':
      return setMusicVisible(project, action.visible);

    case 'set-music-volume':
      return setMusicVolume(project, action.volume);

    case 'set-subtitle-style':
      return setSubtitleStyle(project, action.presetId, action.fontSize);

    case 'set-subtitle-visible':
      return setSubtitleVisible(project, action.visible);
  }
}
