import { useEffect, useReducer, useState } from 'react';
import type { ExportIssue } from '../../../../shared/ipc-contract';
import {
  createExportDialogState,
  exportDialogReducer,
  exportPhaseLabel,
  isExportDialogLocked,
  type ExportDialogError,
} from './export-dialog';

interface ExportDialogProps {
  /** 开始导出前自动保存，返回保存后的内容修订号；失败时抛出。 */
  beforeStart: () => Promise<number>;
  onClose: () => void;
  open: boolean;
  projectId: string;
}

const OUTPUT_SPECS = [
  { label: '容器', value: 'MP4' },
  { label: '画面', value: '1920×1080 · 30fps' },
  { label: '视频编码', value: 'H.264' },
  { label: '音轨', value: '本版本不渲染音频' },
] as const;

function issuesFromDetails(details: unknown): ExportIssue[] | undefined {
  if (details === null || typeof details !== 'object') {
    return undefined;
  }

  const issues = (details as { issues?: unknown }).issues;

  return Array.isArray(issues) ? (issues as ExportIssue[]) : undefined;
}

function startError(message: string): ExportDialogError {
  return { message };
}

/** 导出弹窗：准备 → 渲染 → 完成/失败。渲染期间不允许关闭或重复发起。 */
export function ExportDialog({ beforeStart, onClose, open, projectId }: ExportDialogProps) {
  const [state, dispatch] = useReducer(exportDialogReducer, undefined, () =>
    createExportDialogState(projectId),
  );
  const [targetError, setTargetError] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const locked = isExportDialogLocked(state);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const api = window.miaoma?.export;

    dispatch({ type: 'reset' });
    setTargetError(null);

    if (!api) {
      setTargetError('Preload 桥接未加载，无法导出。');
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
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !locked) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [locked, onClose, open]);

  if (!open) {
    return null;
  }

  const startExport = async (): Promise<void> => {
    const api = window.miaoma?.export;

    if (!api) {
      dispatch({ error: startError('Preload 桥接未加载，无法导出。'), type: 'start-failed' });
      return;
    }

    if (!state.targetPath) {
      dispatch({ error: startError('请先选择导出位置。'), type: 'start-failed' });
      return;
    }

    dispatch({ type: 'start-requested' });

    let revision: number;

    try {
      revision = await beforeStart();
    } catch (error) {
      dispatch({
        error: startError(error instanceof Error ? error.message : '自动保存失败，导出已阻止。'),
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
      dispatch({ error: startError('无法启动导出，请重试。'), type: 'start-failed' });
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
      setTargetError('无法打开保存对话框，请重试。');
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
      setTargetError('无法打开文件夹，请手动到保存位置查看。');
    }
  };

  const error = state.error;
  const title =
    state.step === 'running'
      ? exportPhaseLabel(state.phase)
      : state.step === 'succeeded'
        ? '导出完成'
        : state.step === 'failed'
          ? '导出失败'
          : '渲染导出';

  return (
    <div
      className="ed-export-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="ed-export-title"
        aria-modal="true"
        className="ed-export-dialog"
        role="dialog"
      >
        <h2 className="ed-export-title" id="ed-export-title">
          {title}
        </h2>

        {state.step === 'prepare' ? (
          <>
            <p className="ed-export-description">
              把当前时间线的视频轨渲染为一个可播放的 MP4。开始前会自动保存当前编辑。
            </p>

            <div className="ed-export-path">
              <span className="ed-export-label">保存位置</span>
              <span className="ed-export-path-value" title={state.targetPath}>
                {state.targetPath || (loadingTarget ? '正在读取默认位置…' : '尚未选择')}
              </span>
              <button
                className="ed-export-secondary"
                disabled={state.busy || loadingTarget}
                onClick={() => void chooseTarget()}
                type="button"
              >
                更改…
              </button>
            </div>

            <div className="ed-export-specs">
              {OUTPUT_SPECS.map((spec) => (
                <div className="ed-export-spec" key={spec.label}>
                  <span>{spec.label}</span>
                  <strong>{spec.value}</strong>
                </div>
              ))}
            </div>

            <p className="ed-export-note">
              本切片只渲染视频轨：音频、字幕与剩余时间将在后续切片接入。
            </p>

            {targetError ? <p className="ed-export-error">{targetError}</p> : null}
            {error ? <ExportErrorBlock error={error} /> : null}

            <div className="ed-export-actions">
              <button className="ed-export-secondary" onClick={onClose} type="button">
                取消
              </button>
              <button
                className="ed-export-primary"
                disabled={state.busy || !state.targetPath}
                onClick={() => void startExport()}
                type="button"
              >
                {state.busy ? '正在保存…' : '开始导出'}
              </button>
            </div>
          </>
        ) : null}

        {state.step === 'running' ? (
          <>
            <div className="ed-export-progress" role="status">
              <span aria-hidden="true" className="ed-export-spinner" />
              <span>{exportPhaseLabel(state.phase)}…</span>
            </div>
            <p className="ed-export-description">
              渲染完成前请勿关闭窗口；完成后成品会出现在保存位置。
            </p>
            <p className="ed-export-path-value" title={state.targetPath}>
              {state.targetPath}
            </p>
          </>
        ) : null}

        {state.step === 'succeeded' ? (
          <>
            <p className="ed-export-description">成品已提交，可以直接用常用播放器打开。</p>
            <p className="ed-export-path-value" title={state.outputPath ?? ''}>
              {state.outputPath}
            </p>
            {targetError ? <p className="ed-export-error">{targetError}</p> : null}
            <div className="ed-export-actions">
              <button className="ed-export-secondary" onClick={onClose} type="button">
                关闭
              </button>
              <button
                className="ed-export-primary"
                onClick={() => void revealOutput()}
                type="button"
              >
                在文件夹中显示
              </button>
            </div>
          </>
        ) : null}

        {state.step === 'failed' ? (
          <>
            {error ? <ExportErrorBlock error={error} /> : null}
            <div className="ed-export-actions">
              <button className="ed-export-secondary" onClick={onClose} type="button">
                关闭
              </button>
              <button
                className="ed-export-primary"
                onClick={() => dispatch({ type: 'retry' })}
                type="button"
              >
                重试
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function ExportErrorBlock({ error }: { error: ExportDialogError }) {
  return (
    <div className="ed-export-error-block" role="alert">
      <p className="ed-export-error">{error.message}</p>
      {error.issues && error.issues.length > 0 ? (
        <ul className="ed-export-issues">
          {error.issues.map((issue, index) => (
            <li key={issue.code + '-' + index + '-' + (issue.clipId ?? issue.fieldPath ?? '')}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
