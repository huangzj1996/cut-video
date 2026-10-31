import { describe, expect, it } from 'vitest';
import type { ExportState } from '../../../../shared/ipc-contract';
import {
  createExportDialogState,
  exportDialogReducer,
  exportPhaseLabel,
  isExportDialogLocked,
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

describe('export dialog reducer', () => {
  it('starts in the prepare step with the supplied target', () => {
    const state = createExportDialogState('project-1', 'C:/out.mp4');

    expect(state.step).toBe('prepare');
    expect(state.targetPath).toBe('C:/out.mp4');
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
      }),
      type: 'state',
    });

    expect(state.step).toBe('succeeded');
    expect(state.outputPath).toBe('C:/out.mp4');
    expect(isExportDialogLocked(state)).toBe(false);
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

  it('labels each export phase in Chinese', () => {
    expect(exportPhaseLabel('rendering')).toBe('渲染视频');
    expect(exportPhaseLabel('committing')).toBe('提交成品');
  });
});
