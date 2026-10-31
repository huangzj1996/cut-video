import { useEffect, useReducer, useState } from 'react';
import type { VideoProject } from '@miaoma/video-project';
import { type ExportIssue } from '../../../../shared/ipc-contract';
import {
  createExportDialogState,
  describeExportOutput,
  EXPORT_DIALOG_COPY,
  exportDialogReducer,
  exportDialogTitle,
  exportIssueText,
  exportPhaseLabel,
  isExportDialogLocked,
  type ExportDialogError,
} from './export-dialog';
import {
  formatExportDelta,
  formatExportElapsed,
  formatExportEta,
  formatExportPercent,
  formatExportSpeed,
} from './export-format';

interface ExportDialogProps {
  /** 开始导出前自动保存，返回保存后的内容修订号；失败时抛出。 */
  beforeStart: () => Promise<number>;
  onClose: () => void;
  /** 导出任务锁定编辑器（编辑禁用、预览仍可播放）时通知外层。 */
  onLockChange: (locked: boolean) => void;
  open: boolean;
  /** 当前工程：参数区据此展示输出规格与字幕/源声状态。 */
  project: Pick<VideoProject, 'render' | 'tracks'>;
  projectId: string;
}

function issuesFromDetails(details: unknown): ExportIssue[] | undefined {
  if (details === null || typeof details !== 'object') {
    return undefined;
  }

  const issues = (details as { issues?: unknown }).issues;

  // IPC details 是跨进程边界；只确认它确实是数组，元素形状由主进程契约保证。
  return Array.isArray(issues) ? (issues as ExportIssue[]) : undefined;
}

function startError(message: string): ExportDialogError {
  return { message };
}

function clampPercent(percent: number | null): number | null {
  return percent === null || !Number.isFinite(percent) ? null : Math.min(100, Math.max(0, percent));
}

/** 导出弹窗：准备 → 校验/混音/渲染/自检 → 完成/失败；渲染期间取消需要二次确认。 */
export function ExportDialog({
  beforeStart,
  onClose,
  onLockChange,
  open,
  project,
  projectId,
}: ExportDialogProps) {
  const [state, dispatch] = useReducer(exportDialogReducer, undefined, () =>
    createExportDialogState(projectId),
  );
  const [targetError, setTargetError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const locked = isExportDialogLocked(state);

  // 外层据此锁定编辑与导航。关闭弹窗会重置为准备态，locked 随之回到 false。
  useEffect(() => {
    onLockChange(locked);
  }, [locked, onLockChange]);

  // 渲染中点关闭按钮/Esc/遮罩都先走取消二次确认，而不是直接关窗。
  const requestCancel = (): void => {
    dispatch({ type: 'cancel-requested' });
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const api = window.miaoma?.export;

    dispatch({ type: 'reset' });
    setTargetError(null);
    setCancelError(null);

    if (!api) {
      setTargetError(EXPORT_DIALOG_COPY.error.bridgeMissing);
      return;
    }

    setLoadingTarget(true);

    void (async () => {
      const response = await api.getDefaultTarget(projectId);

      if (cancelled) {
        return;
      }

      setLoadingTarget(false);

      if (response.ok) {
        dispatch({ targetPath: response.data.path, type: 'target-loaded' });
        return;
      }

      setTargetError(response.error.message);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    const api = window.miaoma?.export;

    if (!api) {
      return;
    }

    return api.onState((event) => dispatch({ state: event, type: 'state' }));
  }, []);

  useEffect(() => {
    const api = window.miaoma?.export;

    if (!api) {
      return;
    }

    return api.onProgress((event) => dispatch({ progress: event, type: 'progress' }));
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      // 导出进行中是右下角浮层（预览仍可操作）：Esc 只收起取消确认，不关闭也不发起取消。
      if (state.step === 'running') {
        if (state.cancelStep !== 'idle') {
          dispatch({ type: 'cancel-dismissed' });
        }

        return;
      }

      if (!locked) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [locked, onClose, open, state.cancelStep, state.step]);

  if (!open) {
    return null;
  }

  const startExport = async (): Promise<void> => {
    const api = window.miaoma?.export;

    if (!api) {
      dispatch({
        error: startError(EXPORT_DIALOG_COPY.error.bridgeMissing),
        type: 'start-failed',
      });
      return;
    }

    if (!state.targetPath) {
      dispatch({
        error: startError(EXPORT_DIALOG_COPY.error.targetMissing),
        type: 'start-failed',
      });
      return;
    }

    setCancelError(null);
    dispatch({ type: 'start-requested' });

    let revision: number;

    try {
      revision = await beforeStart();
    } catch (error) {
      dispatch({
        error: startError(
          error instanceof Error ? error.message : EXPORT_DIALOG_COPY.error.autosaveFailed,
        ),
        type: 'start-failed',
      });
      return;
    }

    try {
      const response = await api.start({
        expectedRevision: revision,
        projectId,
        targetPath: state.targetPath,
      });

      if (!response.ok) {
        dispatch({
          error: {
            code: response.error.code,
            issues: issuesFromDetails(response.error.details),
            message: response.error.message,
          },
          type: 'start-failed',
        });
        return;
      }

      dispatch({
        runId: response.data.runId,
        targetPath: response.data.targetPath,
        type: 'started',
      });
    } catch {
      dispatch({ error: startError(EXPORT_DIALOG_COPY.error.startFailed), type: 'start-failed' });
    }
  };

  const chooseTarget = async (): Promise<void> => {
    const api = window.miaoma?.export;

    if (!api) {
      return;
    }

    setLoadingTarget(true);

    try {
      const response = await api.chooseTarget(projectId);

      if (!response.ok) {
        setTargetError(response.error.message);
        return;
      }

      setTargetError(null);

      if (response.data.path) {
        dispatch({ targetPath: response.data.path, type: 'target-changed' });
      }
    } catch {
      setTargetError(EXPORT_DIALOG_COPY.error.targetLoadFailed);
    } finally {
      setLoadingTarget(false);
    }
  };

  const revealOutput = async (): Promise<void> => {
    const api = window.miaoma?.export;

    if (!api || !state.runId) {
      return;
    }

    try {
      const response = await api.reveal(state.runId);

      if (!response.ok) {
        setTargetError(response.error.message);
      }
    } catch {
      setTargetError(EXPORT_DIALOG_COPY.error.revealFailed);
    }
  };

  const dismissCancel = (): void => {
    setCancelError(null);
    dispatch({ type: 'cancel-dismissed' });
  };

  const confirmCancel = async (): Promise<void> => {
    const api = window.miaoma?.export;

    if (!api || !state.runId) {
      return;
    }

    const runId = state.runId;

    setCancelError(null);
    dispatch({ type: 'cancel-confirmed' });

    try {
      const response = await api.cancel(runId);

      if (!response.ok) {
        setCancelError(response.error.message);
        dispatch({ type: 'cancel-dismissed' });
      }
    } catch {
      setCancelError(EXPORT_DIALOG_COPY.error.cancelFailed);
      dispatch({ type: 'cancel-dismissed' });
    }
  };

  const error = state.error;
  const progress = state.progress;
  const percent = clampPercent(progress?.percent ?? null);
  const running = state.step === 'running';
  const showPercent = running && state.phase === 'rendering';
  const title = exportDialogTitle(state.step, state.phase);
  const outputRows = describeExportOutput(project);

  return (
    <div
      // 导出进行中改成右下角浮层：编辑器与预览保持可见可播，编辑仍由会话锁定。
      className={running ? 'ed-export-floating-layer' : 'ed-export-backdrop'}
      onMouseDown={
        running
          ? undefined
          : (event) => {
              if (event.target !== event.currentTarget) {
                return;
              }

              if (!locked) {
                onClose();
              }
            }
      }
      role="presentation"
    >
      <section
        aria-labelledby="ed-export-title"
        aria-modal={running ? undefined : true}
        className={running ? 'ed-export-dialog ed-export-dialog-floating' : 'ed-export-dialog'}
        role="dialog"
      >
        <h2 className="ed-export-title" id="ed-export-title">
          {title}
        </h2>

        {state.step === 'prepare' ? (
          <>
            <p className="ed-export-description">{EXPORT_DIALOG_COPY.prepare.description}</p>

            {state.notice ? (
              <p className="ed-export-notice" role="status">
                {state.notice}
              </p>
            ) : null}

            <div className="ed-export-path">
              <span className="ed-export-label">{EXPORT_DIALOG_COPY.prepare.targetLabel}</span>
              <span className="ed-export-path-value" title={state.targetPath}>
                {state.targetPath ||
                  (loadingTarget
                    ? EXPORT_DIALOG_COPY.prepare.loadingTarget
                    : EXPORT_DIALOG_COPY.prepare.noTarget)}
              </span>
              <button
                className="ed-export-secondary"
                disabled={state.busy || loadingTarget}
                onClick={() => void chooseTarget()}
                type="button"
              >
                {EXPORT_DIALOG_COPY.action.changeTarget}
              </button>
            </div>

            <div className="ed-export-specs">
              {outputRows.map((spec) => (
                <div className="ed-export-spec" key={spec.label}>
                  <span>{spec.label}</span>
                  <strong>{spec.value}</strong>
                </div>
              ))}
            </div>

            {targetError ? <p className="ed-export-error">{targetError}</p> : null}
            {error ? <ExportErrorBlock error={error} /> : null}

            <div className="ed-export-actions">
              <button
                className="ed-export-secondary"
                disabled={state.busy}
                onClick={onClose}
                type="button"
              >
                {EXPORT_DIALOG_COPY.action.cancel}
              </button>
              <button
                className="ed-export-primary"
                disabled={state.busy || !state.targetPath}
                onClick={() => void startExport()}
                type="button"
              >
                {state.busy ? EXPORT_DIALOG_COPY.action.saving : EXPORT_DIALOG_COPY.action.start}
              </button>
            </div>
          </>
        ) : null}

        {state.step === 'running' ? (
          <>
            <div className="ed-export-progress" role="status">
              <span aria-hidden="true" className="ed-export-spinner" />
              <span>{exportPhaseLabel(state.phase)}…</span>
              {showPercent ? (
                <span className="ed-export-percent">{formatExportPercent(percent)}</span>
              ) : null}
            </div>

            {showPercent ? (
              <>
                <div
                  aria-label={EXPORT_DIALOG_COPY.progressLabel}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={percent ?? 0}
                  aria-valuetext={formatExportPercent(percent)}
                  className="ed-export-progressbar"
                  role="progressbar"
                >
                  <div
                    className="ed-export-progressbar-fill"
                    style={{ width: `${percent ?? 0}%` }}
                  />
                </div>
                <ExportMetrics
                  rows={[
                    {
                      label: EXPORT_DIALOG_COPY.metric.eta,
                      value: formatExportEta(progress?.etaMs ?? null),
                    },
                    {
                      label: EXPORT_DIALOG_COPY.metric.elapsed,
                      value: formatExportElapsed(progress?.elapsedMs ?? 0),
                    },
                    {
                      label: EXPORT_DIALOG_COPY.metric.speed,
                      value: formatExportSpeed(progress?.speed ?? null),
                    },
                  ]}
                />
              </>
            ) : null}

            <p className="ed-export-description">{EXPORT_DIALOG_COPY.running.description}</p>
            <p className="ed-export-path-value" title={state.targetPath}>
              {state.targetPath}
            </p>

            {state.cancelStep !== 'idle' ? (
              <div
                aria-label={EXPORT_DIALOG_COPY.cancelPanelLabel}
                className="ed-export-cancel-panel"
                role="alertdialog"
              >
                <p className="ed-export-cancel-text">
                  {state.cancelStep === 'cancelling'
                    ? EXPORT_DIALOG_COPY.running.cancelling
                    : EXPORT_DIALOG_COPY.running.cancelPrompt}
                </p>
                <div className="ed-export-actions">
                  <button
                    className="ed-export-secondary"
                    disabled={state.cancelStep === 'cancelling'}
                    onClick={dismissCancel}
                    type="button"
                  >
                    {EXPORT_DIALOG_COPY.action.continueRendering}
                  </button>
                  <button
                    className="ed-export-primary"
                    disabled={state.cancelStep === 'cancelling'}
                    onClick={() => void confirmCancel()}
                    type="button"
                  >
                    {EXPORT_DIALOG_COPY.action.confirmCancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="ed-export-actions">
                <button className="ed-export-secondary" onClick={requestCancel} type="button">
                  {EXPORT_DIALOG_COPY.action.cancelExport}
                </button>
              </div>
            )}

            {cancelError ? <p className="ed-export-error">{cancelError}</p> : null}
          </>
        ) : null}

        {state.step === 'succeeded' ? (
          <>
            <p className="ed-export-description">{EXPORT_DIALOG_COPY.succeeded.description}</p>
            <p className="ed-export-path-value" title={state.outputPath ?? ''}>
              {state.outputPath}
            </p>
            {state.sync ? (
              <ExportMetrics
                rows={[
                  {
                    label: EXPORT_DIALOG_COPY.sync.startDelta,
                    value: formatExportDelta(state.sync.startDeltaMs),
                  },
                  {
                    label: EXPORT_DIALOG_COPY.sync.durationDelta,
                    value: formatExportDelta(state.sync.durationDeltaMs),
                  },
                ]}
              />
            ) : null}
            {targetError ? <p className="ed-export-error">{targetError}</p> : null}
            <div className="ed-export-actions">
              <button className="ed-export-secondary" onClick={onClose} type="button">
                {EXPORT_DIALOG_COPY.action.close}
              </button>
              <button
                className="ed-export-primary"
                onClick={() => void revealOutput()}
                type="button"
              >
                {EXPORT_DIALOG_COPY.action.reveal}
              </button>
            </div>
          </>
        ) : null}

        {state.step === 'failed' ? (
          <>
            {error ? <ExportErrorBlock error={error} /> : null}
            <div className="ed-export-actions">
              <button className="ed-export-secondary" onClick={onClose} type="button">
                {EXPORT_DIALOG_COPY.action.close}
              </button>
              <button
                className="ed-export-primary"
                onClick={() => dispatch({ type: 'retry' })}
                type="button"
              >
                {EXPORT_DIALOG_COPY.action.retry}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function ExportMetrics({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <dl className="ed-export-metrics">
      {rows.map((row) => (
        <div className="ed-export-metric" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExportErrorBlock({ error }: { error: ExportDialogError }) {
  return (
    <div className="ed-export-error-block" role="alert">
      <p className="ed-export-error">
        {error.code ? <code className="ed-export-error-code">{error.code}</code> : null}
        {error.code ? ' · ' : null}
        {error.message}
      </p>
      {error.issues && error.issues.length > 0 ? (
        <ul className="ed-export-issues">
          {error.issues.map((issue, index) => (
            <li key={issue.code + '-' + index + '-' + (issue.clipId ?? issue.fieldPath ?? '')}>
              {exportIssueText(issue)}
            </li>
          ))}
        </ul>
      ) : null}
      {error.detail ? (
        <details className="ed-export-detail">
          <summary>{EXPORT_DIALOG_COPY.error.detail}</summary>
          <pre>{error.detail}</pre>
        </details>
      ) : null}
    </div>
  );
}
