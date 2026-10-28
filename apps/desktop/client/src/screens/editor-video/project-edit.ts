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
      /** 在播放头处的视频片段内部一分为二。 */
      type: 'split-video';
      atMs: number;
    }
  | {
      /** 删除片段；视频/配音一律被拒绝，字幕/音乐留给后续切片。 */
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
    };

export type EditRejectionCode =
  | 'EDIT_ASSET_REPLACE_BLOCKED'
  | 'EDIT_CLIP_DELETE_UNSUPPORTED'
  | 'EDIT_CLIP_NOT_FOUND'
  | 'EDIT_DELETE_BLOCKED'
  | 'EDIT_INVALID_TARGET_INDEX'
  | 'EDIT_INVARIANT_VIOLATION'
  | 'EDIT_SCENE_ADD_BLOCKED'
  | 'EDIT_SCENE_NOT_FOUND'
  | 'EDIT_SCENE_REMOVE_BLOCKED'
  | 'EDIT_SOURCE_ASSET_MISSING'
  | 'EDIT_SOURCE_RANGE_EXCEEDED'
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
 * 视频右边缘裁剪：分镜锁定模型下，只有分镜末尾的视频片段能改变分镜时长。
 * 缩短时截断配音尾部、裁剪或丢弃越界字幕、后续分镜前移；
 * 延长时配音片段延伸到新结尾（音频播完后为静音），source 不足则拒绝。
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

  const nextProject: VideoProject = {
    ...project,
    scenes: nextScenes,
    tracks: project.tracks.map((track): VideoProject['tracks'][number] => {
      switch (track.kind) {
        case 'video':
          return { ...track, clips: sortedClips(nextVideoClips) };
        case 'voice':
          return { ...track, clips: sortedClips(nextVoiceClips) };
        case 'subtitle':
          return { ...track, clips: sortedClips(nextSubtitleClips) };
        case 'music':
          return track;
      }
    }),
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

/** 在播放头处把视频片段一分为二：两段共享切点，source 区间首尾相接。 */
function splitVideoClip(project: VideoProject, atMs: number): EditResult {
  if (!Number.isInteger(atMs)) {
    return reject('EDIT_SPLIT_OUTSIDE_CLIP', '播放头不在视频片段内部，无法分割。');
  }

  const videoClips = findTrack(project, 'video')?.clips ?? [];
  const target = videoClips.find((clip) => clip.startMs < atMs && atMs < clip.endMs);

  if (!target) {
    return reject('EDIT_SPLIT_OUTSIDE_CLIP', '播放头不在任何视频片段内部，无法分割。');
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
  const violations = findInvariantViolations(nextProject);

  if (violations.length > 0) {
    const [firstViolation] = violations;

    return reject(
      'EDIT_INVARIANT_VIOLATION',
      `编辑会破坏时间线：${firstViolation?.message ?? '未知不变量'}。`,
    );
  }

  return { changed: true, ok: true, project: nextProject };
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

    case 'trim-video':
      return trimVideoClip(project, action.clipId, action.deltaMs);

    case 'split-video':
      return splitVideoClip(project, action.atMs);

    case 'delete-clip': {
      const clip = findClipById(project, action.clipId);

      if (!clip) {
        return reject('EDIT_CLIP_NOT_FOUND', '找不到要删除的片段。');
      }

      // 视频/配音跟随分镜，是原子块；删除会让视频覆盖或配音轨长度失效。
      if (clip.kind === 'video' || clip.kind === 'voice') {
        return reject('EDIT_DELETE_BLOCKED', '视频和配音片段不能删除；请回到创作消息页调整分镜。');
      }

      return reject('EDIT_CLIP_DELETE_UNSUPPORTED', '字幕和音乐片段的删除将在后续版本开放。');
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
  }
}
