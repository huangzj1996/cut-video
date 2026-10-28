import type {
  Scene,
  SubtitleClip,
  VideoClip,
  VideoProject,
  VoiceClip,
} from '@miaoma/video-project';

/**
 * 编辑器编辑纯函数（主接缝）。
 *
 * 时间线采用"分镜锁定"模型：视频轨以分镜为原子块，块与块首尾相接；
 * 拖动视频块即移动整个分镜，视频、配音、字幕片段一起平移。
 * 每次编辑后重新校验时间线不变量，破坏不变量时整次编辑被拒绝。
 */

export type EditAction = {
  /** 把 `sceneId` 对应的分镜移动到新顺序中的 `targetIndex`（0 基）。 */
  type: 'reorder-scene';
  sceneId: string;
  targetIndex: number;
};

export type EditRejectionCode =
  'EDIT_SCENE_NOT_FOUND' | 'EDIT_INVALID_TARGET_INDEX' | 'EDIT_INVARIANT_VIOLATION';

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
  | 'SUBTITLE_OUT_OF_SCENE';

export interface InvariantViolation {
  code: InvariantViolationCode;
  message: string;
}

interface SceneSpan {
  endMs: number;
  startMs: number;
}

type SceneBoundClip = SubtitleClip | VideoClip | VoiceClip;

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

/**
 * 时间线不变量：视频/配音轨连续覆盖、字幕与片段不越出所属分镜、
 * 分镜序号连续、场景引用与轨道一致。编辑器每次编辑后都依赖这套检查。
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
  );

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

function shiftClip<T extends SceneBoundClip>(clip: T, deltaMs: number): T {
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

/**
 * 应用一次编辑：成功返回新文档；拒绝时返回错误码和中文提示，且不修改原文档。
 * 调用方（会话 reducer）负责 dirty、撤销栈和只读判断。
 */
export function applyEdit(project: VideoProject, action: EditAction): EditResult {
  switch (action.type) {
    case 'reorder-scene': {
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

      const nextProject: VideoProject = {
        ...project,
        scenes: nextScenes,
        tracks: reorderTracks(project, deltas),
      };
      const violations = findInvariantViolations(nextProject);

      if (violations.length > 0) {
        const [first] = violations;

        return reject(
          'EDIT_INVARIANT_VIOLATION',
          `编辑会破坏时间线：${first?.message ?? '未知不变量'}。`,
        );
      }

      return { changed: true, ok: true, project: nextProject };
    }
  }
}
