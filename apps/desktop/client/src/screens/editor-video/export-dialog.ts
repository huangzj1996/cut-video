import { EXPORT_CANCELLED_NOTICE } from '../../../../shared/export-copy';
import type {
  ExportIssue,
  ExportPhase,
  ExportProgress,
  ExportState,
  ExportSyncSummary,
  IpcErrorCode,
} from '../../../../shared/ipc-contract';

export { EXPORT_CANCELLED_NOTICE } from '../../../../shared/export-copy';

export type ExportDialogStep = 'failed' | 'prepare' | 'running' | 'succeeded';

/** 取消交互的三态：确认中、正在取消、没有取消交互。 */
export type ExportCancelStep = 'cancelling' | 'confirming' | 'idle';

export interface ExportDialogError {
  code?: IpcErrorCode;
  /** 渲染进程 stderr 尾部等可直接展示的失败详情。 */
  detail?: string;
  issues?: ExportIssue[];
  message: string;
}

/** 只保留 UI 需要的进度字段；runId 由外层状态持有，用于过滤跨任务事件。 */
export interface ExportDialogProgress {
  elapsedMs: number;
  etaMs: number | null;
  percent: number | null;
  renderedMediaMs: number | null;
  speed: number | null;
}

export interface ExportDialogState {
  busy: boolean;
  cancelStep: ExportCancelStep;
  error: ExportDialogError | null;
  notice: string | null;
  outputPath: string | null;
  phase: ExportPhase;
  progress: ExportDialogProgress | null;
  projectId: string;
  runId: string | null;
  step: ExportDialogStep;
  /** 通过同步自检的成品才有客观数字；其余状态为 null。 */
  sync: ExportSyncSummary | null;
  targetPath: string;
}

export type ExportDialogAction =
  | { targetPath: string; type: 'target-loaded' }
  | { targetPath: string; type: 'target-changed' }
  | { type: 'start-requested' }
  | { error: ExportDialogError; type: 'start-failed' }
  | { runId: string; targetPath: string; type: 'started' }
  | { state: ExportState; type: 'state' }
  | { progress: ExportProgress; type: 'progress' }
  | { type: 'cancel-requested' }
  | { type: 'cancel-dismissed' }
  | { type: 'cancel-confirmed' }
  | { type: 'retry' }
  | { type: 'reset' };

export const EXPORT_PHASE_LABELS: Record<ExportPhase, string> = {
  committing: '提交成品',
  mixing: '预混音轨',
  preparing: '准备导出',
  rendering: '渲染视频',
  validating: '前置校验',
  verifying: '同步自检',
};

export function exportPhaseLabel(phase: ExportPhase): string {
  return EXPORT_PHASE_LABELS[phase] ?? '导出处理中';
}

/** 失败原因里的问题定位：把分镜/片段/素材/字段拼成一句可读说明。 */
export function exportIssueLocation(issue: ExportIssue): string | null {
  const parts: string[] = [];

  if (issue.sceneId !== undefined) {
    parts.push('分镜 ' + issue.sceneId);
  }

  if (issue.clipId !== undefined) {
    parts.push('片段 ' + issue.clipId);
  }

  if (issue.assetId !== undefined) {
    parts.push('素材 ' + issue.assetId);
  }

  if (issue.fieldPath !== undefined) {
    parts.push('字段 ' + issue.fieldPath);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/** 失败弹窗里单条问题的完整展示文本：错误码 + 中文文案 + 定位。 */
export function exportIssueText(issue: ExportIssue): string {
  const location = exportIssueLocation(issue);

  return `${issue.code}：${issue.message}${location ? `（${location}）` : ''}`;
}

export function createExportDialogState(projectId = '', targetPath = ''): ExportDialogState {
  return {
    busy: false,
    cancelStep: 'idle',
    error: null,
    notice: null,
    outputPath: null,
    phase: 'preparing',
    progress: null,
    projectId,
    runId: null,
    step: 'prepare',
    sync: null,
    targetPath,
  };
}

export function isExportDialogLocked(state: ExportDialogState): boolean {
  return state.step === 'running' || state.busy;
}

function stateFromEvent(state: ExportDialogState, event: ExportState): ExportDialogState {
  if (event.projectId !== state.projectId) {
    return state;
  }

  // 主进程可能在本 IPC 调用返回前就推送状态；保存/启动期间先按忙碌态认领 runId。
  if (state.runId === null && !state.busy) {
    return state;
  }

  if (state.runId !== null && state.runId !== event.runId) {
    return state;
  }

  const base = state.runId === event.runId ? state : { ...state, runId: event.runId };

  if (event.status === 'running') {
    return { ...base, error: null, phase: event.phase, step: 'running' };
  }

  if (event.status === 'succeeded') {
    return {
      ...base,
      cancelStep: 'idle',
      error: null,
      outputPath: event.outputPath ?? event.targetPath,
      phase: event.phase,
      progress: null,
      step: 'succeeded',
      sync: event.sync ?? null,
    };
  }

  // 取消是终态：临时产物已清理，直接回到准备态并允许再次导出。
  if (event.status === 'cancelled') {
    return {
      ...base,
      busy: false,
      cancelStep: 'idle',
      error: null,
      notice: EXPORT_CANCELLED_NOTICE,
      phase: 'preparing',
      progress: null,
      runId: null,
      step: 'prepare',
      sync: null,
    };
  }

  const error: ExportDialogError = event.error
    ? {
        code: event.error.code,
        ...(event.error.detail ? { detail: event.error.detail } : {}),
        ...(event.error.issues ? { issues: event.error.issues } : {}),
        message: event.error.message,
      }
    : { message: '导出失败，请重试。' };

  return {
    ...base,
    cancelStep: 'idle',
    error,
    phase: event.phase,
    progress: null,
    step: 'failed',
    sync: null,
  };
}

export function exportDialogReducer(
  state: ExportDialogState,
  action: ExportDialogAction,
): ExportDialogState {
  switch (action.type) {
    case 'target-loaded':
    case 'target-changed':
      return isExportDialogLocked(state) ? state : { ...state, targetPath: action.targetPath };

    case 'start-requested':
      return state.step === 'prepare' && !state.busy
        ? {
            ...state,
            busy: true,
            cancelStep: 'idle',
            error: null,
            notice: null,
            progress: null,
          }
        : state;

    case 'start-failed':
      return {
        ...state,
        busy: false,
        cancelStep: 'idle',
        error: action.error,
        progress: null,
        step: 'prepare',
      };

    case 'started':
      // 启动请求期间可能已经收到同一次任务的状态事件，不能把终态覆盖回 running。
      if (state.runId === action.runId && state.step !== 'prepare') {
        return { ...state, busy: false, targetPath: action.targetPath };
      }

      // 取消后迟到的启动响应不能把准备态复活成旧任务；重新发起会先清掉取消提示。
      if (state.notice === EXPORT_CANCELLED_NOTICE) {
        return state;
      }

      return {
        ...state,
        busy: false,
        cancelStep: 'idle',
        error: null,
        notice: null,
        outputPath: null,
        phase: 'preparing',
        progress: null,
        runId: action.runId,
        step: 'running',
        sync: null,
        targetPath: action.targetPath,
      };

    case 'state':
      return stateFromEvent(state, action.state);

    case 'progress':
      // 只接受当前 running 任务自己的进度；跨任务或终态后的迟到事件一律丢弃。
      if (state.step !== 'running' || state.runId === null) {
        return state;
      }

      if (state.runId !== action.progress.runId) {
        return state;
      }

      return {
        ...state,
        progress: {
          elapsedMs: action.progress.elapsedMs,
          etaMs: action.progress.etaMs,
          percent: action.progress.percent,
          renderedMediaMs: action.progress.renderedMediaMs,
          speed: action.progress.speed,
        },
      };

    case 'cancel-requested':
      return state.step === 'running' && state.cancelStep === 'idle'
        ? { ...state, cancelStep: 'confirming' }
        : state;

    case 'cancel-dismissed':
      return state.cancelStep === 'idle' ? state : { ...state, cancelStep: 'idle' };

    case 'cancel-confirmed':
      return state.step === 'running' && state.cancelStep !== 'cancelling'
        ? { ...state, cancelStep: 'cancelling' }
        : state;

    case 'retry':
      return state.step === 'failed'
        ? {
            ...state,
            busy: false,
            cancelStep: 'idle',
            error: null,
            notice: null,
            outputPath: null,
            phase: 'preparing',
            progress: null,
            runId: null,
            step: 'prepare',
            sync: null,
          }
        : state;

    case 'reset':
      return createExportDialogState(state.projectId, state.targetPath);
  }
}
