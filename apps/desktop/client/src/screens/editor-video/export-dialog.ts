import type { VideoProject } from '@miaoma/video-project';
import { EXPORT_CANCELLED_NOTICE } from '../../../../shared/export-copy';
import { shouldBurnSubtitles } from '../../../../shared/subtitle-burn';
import {
  EXPORT_OUTPUT_SPEC,
  type ExportIssue,
  type ExportPhase,
  type ExportProgress,
  type ExportState,
  type ExportSyncSummary,
  type IpcErrorCode,
} from '../../../../shared/ipc-contract';

export { EXPORT_CANCELLED_NOTICE } from '../../../../shared/export-copy';

/**
 * 导出弹窗的面向用户文案集中在这里（成功/失败/取消/参数区）。
 * 主进程的错误文案在 `main/export/messages.ts`；渲染进程自有的提示与按钮在这里，
 * 组件只引用常量，避免同一句话在弹窗与 reducer 各写一份。
 */
export const EXPORT_DIALOG_COPY = {
  action: {
    cancel: '取消',
    cancelExport: '取消导出',
    changeTarget: '更改…',
    close: '关闭',
    confirmCancel: '确认取消',
    continueRendering: '继续渲染',
    retry: '重试',
    reveal: '在文件夹中显示',
    saving: '正在保存…',
    start: '开始导出',
  },
  error: {
    autosaveFailed: '自动保存失败，导出已阻止。',
    bridgeMissing: 'Preload 桥接未加载，无法导出。',
    cancelFailed: '取消导出失败，请重试。',
    exportFailed: '导出失败，请重试。',
    revealFailed: '无法打开文件夹，请手动到保存位置查看。',
    startFailed: '无法启动导出，请重试。',
    detail: '查看失败详情',
    targetLoadFailed: '无法打开保存对话框，请重试。',
    targetMissing: '请先选择导出位置。',
  },
  cancelPanelLabel: '确认取消导出',
  metric: {
    elapsed: '已用',
    eta: '预计剩余',
    speed: '速度',
  },
  /** 参数区与结果区展示的成片事实。 */
  output: {
    burnSubtitles: '烧录',
    muteSourceAudio: '静音',
    skipSubtitles: '不烧录',
  },
  progressLabel: '导出进度',
  prepare: {
    description: '把当前时间线的画面、配音与音乐渲染为一个可播放的 MP4。开始前会自动保存当前编辑。',
    loadingTarget: '正在读取默认位置…',
    noTarget: '尚未选择',
    targetLabel: '保存位置',
  },
  running: {
    cancelPrompt: '确定取消本次导出吗？已渲染的内容不会保留。',
    cancelling: '正在取消…',
    description: '渲染完成前请勿关闭窗口；完成后成品会出现在保存位置。',
  },
  spec: {
    audio: '音轨',
    container: '容器',
    frame: '画面',
    sourceAudio: '源声',
    subtitles: '字幕',
    videoCodec: '视频编码',
  },
  succeeded: {
    description: '成品已提交并通过同步自检，可以直接用常用播放器打开。',
  },
  sync: {
    durationDelta: '时长差',
    startDelta: '起点差',
  },
  title: {
    failed: '导出失败',
    prepare: '渲染导出',
    succeeded: '导出完成',
  },
} as const;

/** 参数区一行：标签 + 已经格式化好的值。 */
export interface ExportDialogOutputRow {
  label: string;
  value: string;
}

/**
 * 参数区展示的固定输出规格，外加随工程即时变化的字幕烧录与源声状态。
 *
 * 烧录状态与主进程共用 `shouldBurnSubtitles`（轨道可见 + 至少一条有效片段）；
 * v1 的 RenderConfig 固定源声静音，因此源声一栏是固定事实而不是开关。
 */
export function describeExportOutput(
  project: Pick<VideoProject, 'render' | 'tracks'>,
): ExportDialogOutputRow[] {
  const burnsSubtitles = shouldBurnSubtitles(project);
  const { audioBitrateKbps, audioCodec, container, fps, height, videoCodec, width } =
    EXPORT_OUTPUT_SPEC;

  return [
    { label: EXPORT_DIALOG_COPY.spec.container, value: container.toUpperCase() },
    {
      label: EXPORT_DIALOG_COPY.spec.frame,
      value: width + '×' + height + ' · ' + fps + 'fps',
    },
    {
      label: EXPORT_DIALOG_COPY.spec.videoCodec,
      value: videoCodec === 'h264' ? 'H.264' : videoCodec,
    },
    {
      label: EXPORT_DIALOG_COPY.spec.audio,
      value: audioCodec.toUpperCase() + ' ' + audioBitrateKbps + 'kbps',
    },
    {
      label: EXPORT_DIALOG_COPY.spec.subtitles,
      value: burnsSubtitles
        ? EXPORT_DIALOG_COPY.output.burnSubtitles
        : EXPORT_DIALOG_COPY.output.skipSubtitles,
    },
    {
      label: EXPORT_DIALOG_COPY.spec.sourceAudio,
      value: EXPORT_DIALOG_COPY.output.muteSourceAudio,
    },
  ];
}

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

/** 弹窗标题：准备、完成、失败三态各自一句；渲染中直接用阶段文案。 */
export function exportDialogTitle(step: ExportDialogStep, phase: ExportPhase): string {
  if (step === 'running') {
    return exportPhaseLabel(phase);
  }

  if (step === 'succeeded') {
    return EXPORT_DIALOG_COPY.title.succeeded;
  }

  if (step === 'failed') {
    return EXPORT_DIALOG_COPY.title.failed;
  }

  return EXPORT_DIALOG_COPY.title.prepare;
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
    : { message: EXPORT_DIALOG_COPY.error.exportFailed };

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
