import type { Scene, StoredProject, SubtitleTrack, VideoProject } from '@miaoma/video-project';
import type { IpcErrorCode, IpcResponse } from '../../../../shared/ipc-contract';
import { isValidProjectId } from '../../lib/routes';

export interface EditorSceneView {
  id: string;
  rangeLabel: string;
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
  | { kind: 'ready'; view: EditorProjectView };

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

/**
 * 编辑器左侧列表的数据来源：只认当前 `project.json`，不读历史消息卡。
 * 分镜文本优先拼接字幕轨中该分镜的片段，没有字幕时回退到文稿。
 */
export function buildEditorProjectView(
  project: VideoProject,
  nowMs = Date.now(),
): EditorProjectView {
  const subtitleTrack = findSubtitleTrack(project);
  const scenes = project.scenes
    .slice()
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  let cursorMs = 0;

  const sceneViews = scenes.map((scene): EditorSceneView => {
    const startMs = cursorMs;
    const endMs = startMs + Math.max(0, scene.durationMs);
    cursorMs = endMs;

    return {
      id: scene.id,
      rangeLabel: `${formatEditorClock(startMs)}-${formatEditorClock(endMs)}`,
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

  return { kind: 'ready', view: buildEditorProjectView(response.data, nowMs) };
}
