/**
 * 编辑器会话状态（编辑 + 撤销栈 + 保存状态 + 只读 + 冲突）。
 *
 * 这是渲染进程里唯一的工程文档来源：所有编辑都经 `applyEdit` 纯函数，
 * 成功后压入撤销栈并标记 dirty；保存状态由 IPC 结果驱动。
 * 只读（工作流运行/等待审批）与冲突状态下拒绝继续编辑。
 */
import type { VideoProject, WorkflowRunStatus } from '@miaoma/video-project';
import { applyEdit, type EditAction } from './project-edit';
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type History,
} from './undo-stack';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface EditorSessionState {
  contentRevision: number;
  dirty: boolean;
  /** 每次成功编辑 +1；保存结果用它判断保存期间是否又有新编辑。 */
  editSeq: number;
  history: History<VideoProject>;
  lastEditError: string | null;
  lastSaveError: string | null;
  /** 始终等于 `history.present`，方便 UI 直接读取当前文档。 */
  project: VideoProject;
  readonly: boolean;
  saveStatus: SaveStatus;
}

export type EditorSessionAction =
  | { action: EditAction; type: 'edit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save-start' }
  | { project: VideoProject; savedSeq: number; type: 'save-success' }
  | { type: 'save-conflict' }
  | { message: string; type: 'save-error' }
  | { readonly: boolean; type: 'readonly-changed' }
  | { project: VideoProject; type: 'reload' };

export interface EditorSessionOptions {
  readonly?: boolean;
}

export function createEditorSession(
  project: VideoProject,
  options: EditorSessionOptions = {},
): EditorSessionState {
  return {
    contentRevision: project.project.contentRevision,
    dirty: false,
    editSeq: 0,
    history: createHistory(project),
    lastEditError: null,
    lastSaveError: null,
    project,
    readonly: options.readonly ?? false,
    saveStatus: 'idle',
  };
}

function canEdit(state: EditorSessionState): boolean {
  return !state.readonly && state.saveStatus !== 'conflict';
}

export function canUndoSession(state: EditorSessionState): boolean {
  return canEdit(state) && canUndo(state.history);
}

export function canRedoSession(state: EditorSessionState): boolean {
  return canEdit(state) && canRedo(state.history);
}

/** 文档发生变化（编辑/撤销/重做）：压入历史、标脏并重新进入待保存状态。 */
function withHistory(
  state: EditorSessionState,
  nextHistory: History<VideoProject>,
): EditorSessionState {
  return {
    ...state,
    dirty: true,
    editSeq: state.editSeq + 1,
    history: nextHistory,
    lastEditError: null,
    project: nextHistory.present,
    saveStatus: 'idle',
  };
}

/** 工作流运行或等待审批时编辑器只读；其他状态可编辑。 */
export function isEditorReadOnly(status: WorkflowRunStatus | null): boolean {
  return status === 'running' || status === 'waiting_user';
}

/**
 * 只读或保存冲突时不得写盘：前者由工作流独占工程，后者写回会覆盖别处的新修订。
 * UI 的手动保存、自动保存与关窗 flush 都先过这一关。
 */
export function canSaveSession(state: EditorSessionState): boolean {
  return !state.readonly && state.saveStatus !== 'conflict';
}

export function editorSessionReducer(
  state: EditorSessionState,
  action: EditorSessionAction,
): EditorSessionState {
  switch (action.type) {
    case 'edit': {
      if (!canEdit(state)) {
        return state;
      }

      const result = applyEdit(state.history.present, action.action);

      if (!result.ok) {
        return { ...state, lastEditError: result.message };
      }

      if (!result.changed) {
        return { ...state, lastEditError: null };
      }

      const nextHistory = commitHistory(state.history, result.project);

      return withHistory(state, nextHistory);
    }

    case 'undo': {
      if (!canUndoSession(state)) {
        return state;
      }

      return withHistory(state, undoHistory(state.history));
    }

    case 'redo': {
      if (!canRedoSession(state)) {
        return state;
      }

      return withHistory(state, redoHistory(state.history));
    }

    case 'save-start':
      return { ...state, lastSaveError: null, saveStatus: 'saving' };

    case 'save-success': {
      // 保存期间又有编辑时，服务端修订号要更新，但本地文档保持 dirty。
      const upToDate = action.savedSeq === state.editSeq;
      const nextHistory = upToDate ? { ...state.history, present: action.project } : state.history;

      return {
        ...state,
        contentRevision: action.project.project.contentRevision,
        dirty: !upToDate,
        history: nextHistory,
        lastSaveError: null,
        project: nextHistory.present,
        saveStatus: upToDate ? 'saved' : 'idle',
      };
    }

    case 'save-conflict':
      return { ...state, saveStatus: 'conflict' };

    case 'save-error':
      return { ...state, lastSaveError: action.message, saveStatus: 'error' };

    case 'readonly-changed':
      return state.readonly === action.readonly ? state : { ...state, readonly: action.readonly };

    case 'reload':
      return {
        ...state,
        contentRevision: action.project.project.contentRevision,
        dirty: false,
        history: createHistory(action.project),
        lastEditError: null,
        lastSaveError: null,
        project: action.project,
        saveStatus: 'idle',
      };
  }
}
