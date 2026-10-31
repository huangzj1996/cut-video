import type {
  ExportIssue,
  ExportPhase,
  ExportState,
  IpcErrorCode,
} from '../../../../shared/ipc-contract';

export type ExportDialogStep = 'failed' | 'prepare' | 'running' | 'succeeded';

export interface ExportDialogError {
  code?: IpcErrorCode;
  issues?: ExportIssue[];
  message: string;
}

export interface ExportDialogState {
  busy: boolean;
  error: ExportDialogError | null;
  outputPath: string | null;
  phase: ExportPhase;
  projectId: string;
  runId: string | null;
  step: ExportDialogStep;
  targetPath: string;
}

export type ExportDialogAction =
  | { targetPath: string; type: 'target-loaded' }
  | { targetPath: string; type: 'target-changed' }
  | { type: 'start-requested' }
  | { error: ExportDialogError; type: 'start-failed' }
  | { runId: string; targetPath: string; type: 'started' }
  | { state: ExportState; type: 'state' }
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

export function createExportDialogState(projectId = '', targetPath = ''): ExportDialogState {
  return {
    busy: false,
    error: null,
    outputPath: null,
    phase: 'preparing',
    projectId,
    runId: null,
    step: 'prepare',
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
      error: null,
      outputPath: event.outputPath ?? event.targetPath,
      phase: event.phase,
      step: 'succeeded',
    };
  }

  return {
    ...base,
    error: event.error
      ? {
          code: event.error.code,
          message: event.error.message,
          ...(event.error.issues ? { issues: event.error.issues } : {}),
        }
      : { message: '导出失败，请重试。' },
    phase: event.phase,
    step: 'failed',
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
        ? { ...state, busy: true, error: null }
        : state;

    case 'start-failed':
      return { ...state, busy: false, error: action.error, step: 'prepare' };

    case 'started':
      // 启动请求期间可能已经收到同一次任务的状态事件，不能把终态覆盖回 running。
      if (state.runId === action.runId && state.step !== 'prepare') {
        return { ...state, busy: false, targetPath: action.targetPath };
      }

      return {
        ...state,
        busy: false,
        error: null,
        outputPath: null,
        phase: 'preparing',
        runId: action.runId,
        step: 'running',
        targetPath: action.targetPath,
      };

    case 'state':
      return stateFromEvent(state, action.state);

    case 'retry':
      return state.step === 'failed'
        ? {
            ...state,
            error: null,
            outputPath: null,
            phase: 'preparing',
            runId: null,
            step: 'prepare',
          }
        : state;

    case 'reset':
      return createExportDialogState(state.projectId, state.targetPath);
  }
}
