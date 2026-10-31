import { describe, expect, it } from 'vitest';
import type { ExportProgress, ExportState } from '../../../../shared/ipc-contract';
import {
  createExportDialogState,
  EXPORT_CANCELLED_NOTICE,
  exportDialogReducer,
  exportIssueLocation,
  exportIssueText,
  exportPhaseLabel,
  isExportDialogLocked,
  type ExportDialogState,
} from './export-dialog';

function runningState(overrides: Partial<ExportState> = {}): ExportState {
  return {
    phase: 'rendering',
    projectId: 'project-1',
    runId: 'run-1',
    status: 'running',
    targetPath: 'C:/out.mp4',
    ...overrides,
  };
}

function cancelledState(overrides: Partial<ExportState> = {}): ExportState {
  return {
    error: { code: 'EXPORT_CANCELLED', message: '导出已取消。' },
    phase: 'rendering',
    projectId: 'project-1',
    runId: 'run-1',
    status: 'cancelled',
    targetPath: 'C:/out.mp4',
    ...overrides,
  };
}

function progressEvent(overrides: Partial<ExportProgress> = {}): ExportProgress {
  return {
    elapsedMs: 12_000,
    etaMs: 8_000,
    percent: 42.4,
    phase: 'rendering',
    renderedMediaMs: 5_000,
    runId: 'run-1',
    speed: 12.34,
    ...overrides,
  };
}

function startedState(): ExportDialogState {
  return exportDialogReducer(createExportDialogState('project-1', 'C:/out.mp4'), {
    runId: 'run-1',
    targetPath: 'C:/out.mp4',
    type: 'started',
  });
}

describe('exportIssueLocation', () => {
  it('locates a capability problem by scene, clip and asset', () => {
    expect(
      exportIssueLocation({
        assetId: 'video-a',
        clipId: 'clip-1',
        code: 'EXPORT_UNSUPPORTED_MEDIA',
        message: '不支持的视频编码。',
        sceneId: 'scene-1',
      }),
    ).toBe('分镜 scene-1 · 片段 clip-1 · 素材 video-a');
  });

  it('shows the error code, Chinese copy and locator together', () => {
    expect(
      exportIssueText({
        assetId: 'video-a',
        clipId: 'clip-1',
        code: 'EXPORT_UNSUPPORTED_MEDIA',
        message: '不支持的视频编码：hevc。目前仅支持 H.264/AAC 的 MP4/MOV。',
        sceneId: 'scene-1',
      }),
    ).toBe(
      'EXPORT_UNSUPPORTED_MEDIA：不支持的视频编码：hevc。目前仅支持 H.264/AAC 的 MP4/MOV。（分镜 scene-1 · 片段 clip-1 · 素材 video-a）',
    );
  });

  it('falls back to the field path and returns null without any locator', () => {
    expect(
      exportIssueLocation({
        code: 'EXPORT_UNSUPPORTED_TRANSFORM',
        fieldPath: 'crop',
        message: '只支持默认裁剪。',
      }),
    ).toBe('字段 crop');
    expect(exportIssueLocation({ code: 'EXPORT_VALIDATION_FAILED', message: '失败。' })).toBeNull();
  });
});

describe('export dialog reducer', () => {
  it('starts in the prepare step with the supplied target', () => {
    const state = createExportDialogState('project-1', 'C:/out.mp4');

    expect(state.step).toBe('prepare');
    expect(state.targetPath).toBe('C:/out.mp4');
    expect(state.progress).toBeNull();
    expect(state.notice).toBeNull();
    expect(state.cancelStep).toBe('idle');
    expect(isExportDialogLocked(state)).toBe(false);
  });

  it('loads and changes the target only when idle', () => {
    let state = exportDialogReducer(createExportDialogState(), {
      targetPath: 'C:/default.mp4',
      type: 'target-loaded',
    });
    state = exportDialogReducer(state, { targetPath: 'C:/changed.mp4', type: 'target-changed' });
    state = { ...state, busy: true };
    state = exportDialogReducer(state, { targetPath: 'C:/ignored.mp4', type: 'target-changed' });

    expect(state.targetPath).toBe('C:/changed.mp4');
  });

  it('marks the dialog busy while saving and blocks a second start', () => {
    let state = exportDialogReducer(createExportDialogState('project-1', 'C:/out.mp4'), {
      type: 'start-requested',
    });

    expect(state.busy).toBe(true);
    expect(isExportDialogLocked(state)).toBe(true);

    const second = exportDialogReducer(state, { type: 'start-requested' });
    expect(second).toBe(state);

    state = exportDialogReducer(state, {
      error: { message: '自动保存失败，导出已阻止。' },
      type: 'start-failed',
    });
    expect(state.step).toBe('prepare');
    expect(state.busy).toBe(false);
    expect(state.error?.message).toBe('自动保存失败，导出已阻止。');
  });

  it('follows the running state of the started run and ignores other runs', () => {
    let state = exportDialogReducer(createExportDialogState('project-1', 'C:/out.mp4'), {
      runId: 'run-1',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });

    expect(state.step).toBe('running');
    expect(isExportDialogLocked(state)).toBe(true);

    state = exportDialogReducer(state, {
      state: runningState({ phase: 'committing' }),
      type: 'state',
    });
    expect(state.phase).toBe('committing');

    const ignored = exportDialogReducer(state, {
      state: runningState({ runId: 'other-run', status: 'failed' }),
      type: 'state',
    });
    expect(ignored).toBe(state);

    const ignoredProgress = exportDialogReducer(state, {
      progress: progressEvent({ runId: 'other-run' }),
      type: 'progress',
    });
    expect(ignoredProgress).toBe(state);
  });

  it('moves to succeeded with the committed output path', () => {
    let state = exportDialogReducer(createExportDialogState('project-1', 'C:/out.mp4'), {
      runId: 'run-1',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });
    state = exportDialogReducer(state, {
      state: runningState({
        outputPath: 'C:/out.mp4',
        phase: 'committing',
        status: 'succeeded',
        sync: { durationDeltaMs: 0, startDeltaMs: 0 },
      }),
      type: 'state',
    });

    expect(state.step).toBe('succeeded');
    expect(state.outputPath).toBe('C:/out.mp4');
    expect(state.sync).toEqual({ durationDeltaMs: 0, startDeltaMs: 0 });
    expect(isExportDialogLocked(state)).toBe(false);
  });

  it('has no sync measurements until the export succeeds', () => {
    let state = startedState();

    expect(state.sync).toBeNull();

    state = exportDialogReducer(state, {
      state: runningState({ phase: 'verifying' }),
      type: 'state',
    });
    expect(state.sync).toBeNull();

    state = exportDialogReducer(state, {
      state: runningState({
        error: { code: 'EXPORT_SYNC_CHECK_FAILED', message: '同步自检未通过。' },
        phase: 'verifying',
        status: 'failed',
      }),
      type: 'state',
    });
    expect(state.sync).toBeNull();
  });

  it('moves to failed with issues and can retry from prepare', () => {
    let state = exportDialogReducer(createExportDialogState('project-1', 'C:/out.mp4'), {
      runId: 'run-1',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });
    state = exportDialogReducer(state, {
      state: runningState({
        error: {
          code: 'EXPORT_VALIDATION_FAILED',
          issues: [{ code: 'ASSET_FILE_MISSING', message: '素材缺失' }],
          message: '导出前校验未通过。',
        },
        status: 'failed',
      }),
      type: 'state',
    });

    expect(state.step).toBe('failed');
    expect(state.error?.issues).toHaveLength(1);

    const retried = exportDialogReducer(state, { type: 'retry' });
    expect(retried.step).toBe('prepare');
    expect(retried.targetPath).toBe('C:/out.mp4');
    expect(retried.error).toBeNull();
  });

  it('adopts state events that arrive before the start response', () => {
    let state = createExportDialogState('project-1', 'C:/out.mp4');
    state = exportDialogReducer(state, { type: 'start-requested' });
    state = exportDialogReducer(state, {
      state: runningState({ phase: 'rendering' }),
      type: 'state',
    });

    expect(state.runId).toBe('run-1');
    expect(state.step).toBe('running');
    expect(state.phase).toBe('rendering');

    const started = exportDialogReducer(state, {
      runId: 'run-1',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });
    expect(started.step).toBe('running');
    expect(started.phase).toBe('rendering');
  });

  it('does not regress a terminal state when the start response arrives late', () => {
    let state = createExportDialogState('project-1', 'C:/out.mp4');
    state = exportDialogReducer(state, { type: 'start-requested' });
    state = exportDialogReducer(state, {
      state: runningState({ outputPath: 'C:/out.mp4', status: 'succeeded' }),
      type: 'state',
    });
    state = exportDialogReducer(state, {
      runId: 'run-1',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });

    expect(state.step).toBe('succeeded');
    expect(state.busy).toBe(false);
  });

  it('keeps live progress for the running run only', () => {
    let state = startedState();
    state = exportDialogReducer(state, { progress: progressEvent(), type: 'progress' });

    expect(state.progress).toEqual({
      elapsedMs: 12_000,
      etaMs: 8_000,
      percent: 42.4,
      renderedMediaMs: 5_000,
      speed: 12.34,
    });

    const fromIdle = exportDialogReducer(createExportDialogState('project-1', 'C:/out.mp4'), {
      progress: progressEvent(),
      type: 'progress',
    });
    expect(fromIdle.progress).toBeNull();
  });

  it('ignores progress that arrives after a terminal state', () => {
    let state = startedState();
    state = exportDialogReducer(state, {
      state: runningState({ status: 'failed' }),
      type: 'state',
    });

    expect(state.progress).toBeNull();

    const ignored = exportDialogReducer(state, { progress: progressEvent(), type: 'progress' });
    expect(ignored).toBe(state);
  });

  it('requires a confirmation before cancelling a running export', () => {
    const idle = createExportDialogState('project-1', 'C:/out.mp4');
    expect(exportDialogReducer(idle, { type: 'cancel-requested' })).toBe(idle);

    let state = startedState();
    state = exportDialogReducer(state, { type: 'cancel-requested' });
    expect(state.step).toBe('running');
    expect(state.cancelStep).toBe('confirming');

    state = exportDialogReducer(state, { type: 'cancel-dismissed' });
    expect(state.cancelStep).toBe('idle');

    state = exportDialogReducer(state, { type: 'cancel-requested' });
    state = exportDialogReducer(state, { type: 'cancel-confirmed' });
    expect(state.step).toBe('running');
    expect(state.cancelStep).toBe('cancelling');

    const repeated = exportDialogReducer(state, { type: 'cancel-confirmed' });
    expect(repeated).toBe(state);

    state = exportDialogReducer(state, { type: 'cancel-dismissed' });
    expect(state.cancelStep).toBe('idle');
  });

  it('returns to prepare with a notice after cancellation and can start again', () => {
    let state = createExportDialogState('project-1', 'C:/out.mp4');
    state = exportDialogReducer(state, { type: 'start-requested' });
    state = exportDialogReducer(state, { state: runningState(), type: 'state' });
    state = exportDialogReducer(state, { type: 'cancel-requested' });
    state = exportDialogReducer(state, { type: 'cancel-confirmed' });
    state = exportDialogReducer(state, { state: cancelledState(), type: 'state' });

    expect(state.step).toBe('prepare');
    expect(state.notice).toBe(EXPORT_CANCELLED_NOTICE);
    expect(state.error).toBeNull();
    expect(state.progress).toBeNull();
    expect(state.runId).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.cancelStep).toBe('idle');
    expect(isExportDialogLocked(state)).toBe(false);

    state = exportDialogReducer(state, { type: 'start-requested' });
    expect(state.notice).toBeNull();
    expect(state.busy).toBe(true);

    state = exportDialogReducer(state, {
      runId: 'run-2',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });
    expect(state.step).toBe('running');
    expect(state.runId).toBe('run-2');
  });

  it('does not let a late start response revive a cancelled export', () => {
    let state = createExportDialogState('project-1', 'C:/out.mp4');
    state = exportDialogReducer(state, { type: 'start-requested' });
    state = exportDialogReducer(state, { state: runningState(), type: 'state' });
    state = exportDialogReducer(state, { type: 'cancel-confirmed' });
    state = exportDialogReducer(state, { state: cancelledState(), type: 'state' });

    const started = exportDialogReducer(state, {
      runId: 'run-1',
      targetPath: 'C:/out.mp4',
      type: 'started',
    });

    expect(started.step).toBe('prepare');
    expect(started.runId).toBeNull();
    expect(started.notice).toBe(EXPORT_CANCELLED_NOTICE);
    expect(started.busy).toBe(false);
  });

  it('keeps the failure detail for the expandable error view', () => {
    let state = startedState();
    state = exportDialogReducer(state, {
      state: runningState({
        error: {
          code: 'EXPORT_RENDER_FAILED',
          detail: 'ffmpeg exited with code 1',
          message: '渲染进程异常退出。',
        },
        status: 'failed',
      }),
      type: 'state',
    });

    expect(state.step).toBe('failed');
    expect(state.error?.detail).toBe('ffmpeg exited with code 1');
    expect(state.cancelStep).toBe('idle');
  });

  it('clears progress and cancellation flags on retry', () => {
    let state = startedState();
    state = exportDialogReducer(state, {
      state: runningState({ status: 'failed' }),
      type: 'state',
    });
    state = {
      ...state,
      cancelStep: 'cancelling',
      progress: { elapsedMs: 1000, etaMs: null, percent: 1, renderedMediaMs: null, speed: null },
    };

    const retried = exportDialogReducer(state, { type: 'retry' });

    expect(retried.step).toBe('prepare');
    expect(retried.busy).toBe(false);
    expect(retried.progress).toBeNull();
    expect(retried.cancelStep).toBe('idle');
    expect(retried.error).toBeNull();
  });

  it('resets to a clean prepare state', () => {
    let state = startedState();
    state = exportDialogReducer(state, { progress: progressEvent(), type: 'progress' });
    state = exportDialogReducer(state, { type: 'cancel-requested' });

    const reset = exportDialogReducer(state, { type: 'reset' });

    expect(reset).toEqual(createExportDialogState('project-1', 'C:/out.mp4'));
  });

  it('labels each export phase in Chinese', () => {
    expect(exportPhaseLabel('rendering')).toBe('渲染视频');
    expect(exportPhaseLabel('committing')).toBe('提交成品');
  });
});
