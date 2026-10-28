import { VOICE_PRESETS } from '@miaoma/video-project';
import type {
  Scene,
  StoredProject,
  SubtitleTrack,
  VideoProject,
  VoiceClip,
  VoiceTrack,
} from '@miaoma/video-project';
import type { IpcErrorCode, IpcResponse } from '../../../../shared/ipc-contract';
import { isValidProjectId } from '../../lib/routes';

/** 画面面板上下文卡的一行标签：左侧类目、右侧当前分镜的取值。 */
export interface SceneContextTag {
  label: string;
  value: string;
}

export interface EditorSceneView {
  /** 分镜的画面意图 + 备注合成的分析段落；两者都为空时为 null（面板隐藏该段）。 */
  analysis: string | null;
  endSeconds: number;
  /** 分镜自身标题（不是左侧列表的"分镜 01"）。 */
  heading: string;
  id: string;
  rangeLabel: string;
  script: string;
  startSeconds: number;
  tags: SceneContextTag[];
  text: string;
  title: string;
}

export interface EditorProjectView {
  name: string;
  projectId: string;
  sceneCount: number;
  scenes: EditorSceneView[];
  totalDurationLabel: string;
  updatedLabel: string;
}

export type EditorLoadResult =
  | { kind: 'draft'; projectId: string }
  | { code: IpcErrorCode; kind: 'error'; message: string }
  | { kind: 'ready'; project: VideoProject; view: EditorProjectView };

export interface ProjectReader {
  get(projectId: string): Promise<IpcResponse<StoredProject>>;
}

const LOAD_FAILED_MESSAGE = '读取工程失败，请重试。';
const INVALID_PROJECT_ID_MESSAGE = '工程地址无效。';

const PROJECT_LOAD_ERROR_MESSAGES: Partial<Record<IpcErrorCode, string>> = {
  PROJECT_INVALID: '工程文件结构无效，可能已损坏。',
  PROJECT_INVALID_ARGUMENT: INVALID_PROJECT_ID_MESSAGE,
  PROJECT_NOT_FOUND: '工程不存在或已被删除。',
  PROJECT_READ_FAILED: LOAD_FAILED_MESSAGE,
  PROJECT_SCHEMA_UNSUPPORTED: '工程版本与当前应用不兼容。',
};

function formatEditorClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return hours > 0 ? `${String(hours).padStart(2, '0')}:${clock}` : clock;
}

function sceneLabel(scene: Scene): string {
  return `分镜 ${String(scene.index).padStart(2, '0')}`;
}

function sceneSubtitleText(sceneId: string, track: SubtitleTrack | undefined): string {
  if (!track) {
    return '';
  }

  return track.clips
    .filter((clip) => clip.sceneId === sceneId)
    .sort((left, right) => left.startMs - right.startMs)
    .map((clip) => clip.text.trim())
    .filter((text) => text.length > 0)
    .join('\n');
}

function findSubtitleTrack(project: VideoProject): SubtitleTrack | undefined {
  return project.tracks.find((track): track is SubtitleTrack => track.kind === 'subtitle');
}

/** 画面模式与创作倾向在 v1 是固定值（PRD §9.2：仅 AI 智能创作；画面仅智能匹配素材）。 */
const VIDEO_MODE_LABEL = '智能匹配素材';
const CREATION_MODE_LABEL = 'AI 智能创作（默认）';

function sceneAnalysis(scene: Scene): string | null {
  const lines = [scene.visualIntent.trim(), scene.notes.trim()].filter((line) => line.length > 0);

  return lines.length > 0 ? lines.join('\n') : null;
}

/** 视频画面标签：随分镜已匹配的素材段数变化，缺失的匹配项也如实标出。 */
function videoTagValue(project: VideoProject, scene: Scene): string {
  const registeredIds = new Set(project.assets.videos.map((asset) => asset.id));
  const matched = scene.matchedVideoAssetIds.filter((id) => registeredIds.has(id));

  if (scene.matchedVideoAssetIds.length === 0) {
    return `${VIDEO_MODE_LABEL} · 未匹配`;
  }

  const missing = scene.matchedVideoAssetIds.length - matched.length;

  return missing > 0
    ? `${VIDEO_MODE_LABEL} · ${matched.length} 段（${missing} 个缺失）`
    : `${VIDEO_MODE_LABEL} · ${matched.length} 段`;
}

/** 旁白配音标签：音色名来自该分镜配音片段的 preset，缺失时明确标注而不是编造。 */
function voiceTagValue(project: VideoProject, clip: VoiceClip | undefined): string {
  if (!clip) {
    return '未生成配音';
  }

  const asset = project.assets.voices.find((item) => item.id === clip.assetId);

  if (!asset) {
    return '配音缺失';
  }

  const preset = VOICE_PRESETS.find((item) => item.id === clip.voicePreset);
  const name = preset?.name ?? clip.voicePreset;

  return asset.isMock ? `${name}（模拟）` : name;
}

function buildSceneTags(
  project: VideoProject,
  scene: Scene,
  voiceClip: VoiceClip | undefined,
): SceneContextTag[] {
  return [
    { label: '视频画面', value: videoTagValue(project, scene) },
    { label: '旁白配音', value: voiceTagValue(project, voiceClip) },
    { label: '创作倾向', value: CREATION_MODE_LABEL },
  ];
}

/** 每个分镜只取第一条配音片段作为面板标签来源（配音轨按分镜锁定）。 */
function voiceClipsByScene(project: VideoProject): Map<string, VoiceClip> {
  const track = project.tracks.find((item): item is VoiceTrack => item.kind === 'voice');
  const byScene = new Map<string, VoiceClip>();

  for (const clip of (track?.clips ?? [])
    .slice()
    .sort((left, right) => left.startMs - right.startMs)) {
    if (clip.sceneId && !byScene.has(clip.sceneId)) {
      byScene.set(clip.sceneId, clip);
    }
  }

  return byScene;
}

/**
 * 编辑器左侧列表的数据来源：只认当前 `project.json`，不读历史消息卡。
 * 分镜文本优先拼接字幕轨中该分镜的片段，没有字幕时回退到文稿。
 */
export function buildEditorProjectView(
  project: VideoProject,
  nowMs = Date.now(),
): EditorProjectView {
  const subtitleTrack = findSubtitleTrack(project);
  const voiceByScene = voiceClipsByScene(project);
  const scenes = project.scenes
    .slice()
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  let cursorMs = 0;

  const sceneViews = scenes.map((scene): EditorSceneView => {
    const startMs = cursorMs;
    const endMs = startMs + Math.max(0, scene.durationMs);
    cursorMs = endMs;

    return {
      analysis: sceneAnalysis(scene),
      endSeconds: endMs / 1_000,
      heading: scene.title,
      id: scene.id,
      rangeLabel: `${formatEditorClock(startMs)}-${formatEditorClock(endMs)}`,
      script: scene.script,
      startSeconds: startMs / 1_000,
      tags: buildSceneTags(project, scene, voiceByScene.get(scene.id)),
      text: sceneSubtitleText(scene.id, subtitleTrack) || scene.script,
      title: sceneLabel(scene),
    };
  });

  return {
    name: project.project.name,
    projectId: project.project.projectId,
    sceneCount: sceneViews.length,
    scenes: sceneViews,
    totalDurationLabel: formatEditorClock(cursorMs),
    updatedLabel: formatUpdatedLabel(project.project.updatedAt, nowMs),
  };
}

export function formatUpdatedLabel(updatedAt: string, nowMs: number): string {
  const updatedMs = Date.parse(updatedAt);

  if (!Number.isFinite(updatedMs)) {
    return '更新时间未知';
  }

  const diffMs = Math.max(0, nowMs - updatedMs);
  const minuteMs = 60_000;

  if (diffMs < minuteMs) {
    return '刚刚更新';
  }

  if (diffMs < 60 * minuteMs) {
    return `${Math.floor(diffMs / minuteMs)} 分钟前更新`;
  }

  if (diffMs < 24 * 60 * minuteMs) {
    return `${Math.floor(diffMs / (60 * minuteMs))} 小时前更新`;
  }

  return `${Math.floor(diffMs / (24 * 60 * minuteMs))} 天前更新`;
}

export async function loadEditorProject(
  reader: ProjectReader,
  projectId: string,
  nowMs = Date.now(),
): Promise<EditorLoadResult> {
  if (!isValidProjectId(projectId)) {
    return {
      code: 'PROJECT_INVALID_ARGUMENT',
      kind: 'error',
      message: INVALID_PROJECT_ID_MESSAGE,
    };
  }

  let response: IpcResponse<StoredProject>;

  try {
    response = await reader.get(projectId);
  } catch {
    return { code: 'PROJECT_READ_FAILED', kind: 'error', message: LOAD_FAILED_MESSAGE };
  }

  if (!response.ok) {
    return {
      code: response.error.code,
      kind: 'error',
      message: PROJECT_LOAD_ERROR_MESSAGES[response.error.code] ?? LOAD_FAILED_MESSAGE,
    };
  }

  if (!('ai' in response.data)) {
    return { kind: 'draft', projectId };
  }

  return {
    kind: 'ready',
    project: response.data,
    view: buildEditorProjectView(response.data, nowMs),
  };
}
