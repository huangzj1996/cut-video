import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ExportErrorInfo, ExportPhase } from '../../shared/ipc-contract';
import { exportTempArtifactsFromPlan, removeExportTempArtifacts } from './artifacts';
import { EXPORT_MESSAGES } from './messages';
import type { ExportPlan } from './plan';
import { createRenderProgressParser, type RenderProgressSample } from './progress';
import type { ExportProcessHandle, ExportProcessResult, ExportProcessRunner } from './runner';

/** 取消时先请 ffmpeg 优雅退出，最多等这么久再强杀进程树。 */
export const EXPORT_CANCEL_GRACE_MS = 3_000;

export interface ExportJobOptions {
  onPhase?: (phase: ExportPhase) => void;
  /** 渲染阶段的真实进度样本；mixing/committing 等阶段不会回调。 */
  onProgress?: (sample: RenderProgressSample) => void;
  plan: ExportPlan;
  runner: ExportProcessRunner;
}

export type ExportJobResult =
  | { cancelled: true; ok: false; phase: ExportPhase }
  | { error: ExportErrorInfo; ok: false }
  | { ok: true; outputPath: string };

export interface ExportJobHandle {
  /** 请求取消；重复调用是 no-op。任务会等到当前进程退出并清理完临时产物后才收束。 */
  cancel(): void;
  /** 任务结束（成功、失败或取消）时 resolve。 */
  readonly result: Promise<ExportJobResult>;
}

/** 单个阶段的结果：进程真正退出，或在启动前/启动时已被取消。 */
type PhaseOutcome = { status: 'cancelled' } | { status: 'exited'; result: ExportProcessResult };

function fileSize(filePath: string): number {
  try {
    return existsSync(filePath) ? statSync(filePath).size : 0;
  } catch {
    // 读不到大小按无产物处理。
    return 0;
  }
}

/** 失败原因保留 stderr 尾部，供“查看失败详情”在本次会话内展开。 */
function failure(message: string, stderrTail: string): ExportJobResult {
  const detail = stderrTail.trim();

  return {
    error: { code: 'EXPORT_RENDER_FAILED', message, ...(detail.length > 0 ? { detail } : {}) },
    ok: false,
  };
}

function cancelledResult(phase: ExportPhase): ExportJobResult {
  return { cancelled: true, ok: false, phase };
}

/**
 * 把 ASS 与随包字体写到目标目录，供 ffmpeg 以相对 ASCII 路径烧录。
 * 字体文件缺失/不可复制时报 EXPORT_FONT_MISSING，而不是让 ffmpeg 悄悄用错字体。
 */
function prepareSubtitleArtifacts(plan: ExportPlan): ExportErrorInfo | null {
  if (!plan.subtitles) {
    return null;
  }

  try {
    writeFileSync(plan.subtitles.assPath, plan.subtitles.assText, 'utf8');
  } catch {
    return { code: 'EXPORT_RENDER_FAILED', message: EXPORT_MESSAGES.subtitleWriteFailed };
  }

  try {
    mkdirSync(plan.subtitles.fontsDirPath, { recursive: true });

    for (const fontFile of plan.subtitles.fontFiles) {
      copyFileSync(fontFile, path.join(plan.subtitles.fontsDirPath, path.basename(fontFile)));
    }
  } catch {
    return { code: 'EXPORT_FONT_MISSING', message: EXPORT_MESSAGES.subtitleFontPrepareFailed };
  }

  return null;
}

/**
 * 执行一次两段式导出，并允许在任一阶段取消。
 *
 * 取消语义：先向当前 ffmpeg 的 stdin 写 q 请求优雅退出，最多等
 * EXPORT_CANCEL_GRACE_MS；超时用 taskkill /T /F 结束进程树。无论哪种方式，
 * 任务都会等进程真正退出后删掉临时产物，并且永不提交。
 *
 * 成功判定不依赖 progress=end，也不只看退出码：取消标记、退出码、预混音轨
 * 与临时成品是否真实产出，三者同时满足才会提交。
 */
export function startExportJob(options: ExportJobOptions): ExportJobHandle {
  const { plan, runner } = options;
  const artifacts = exportTempArtifactsFromPlan(plan);
  let cancelled = false;
  let active: ExportProcessHandle | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPhase: ExportPhase = 'preparing';

  const clearKillTimer = (): void => {
    if (killTimer !== null) {
      clearTimeout(killTimer);
      killTimer = null;
    }
  };

  const requestQuit = (handle: ExportProcessHandle): void => {
    clearKillTimer();
    handle.requestQuit();
    killTimer = setTimeout(() => {
      killTimer = null;
      handle.killTree();
    }, EXPORT_CANCEL_GRACE_MS);
  };

  const cancel = (): void => {
    if (cancelled) {
      return;
    }

    cancelled = true;

    if (active) {
      requestQuit(active);
    }
  };

  const runPhase = async (
    phase: ExportPhase,
    command: { args: string[]; command: string },
    onStdoutChunk?: (chunk: string) => void,
  ): Promise<PhaseOutcome> => {
    if (cancelled) {
      return { status: 'cancelled' };
    }

    currentPhase = phase;
    options.onPhase?.(phase);

    const handle = runner({
      args: command.args,
      command: command.command,
      cwd: plan.cwd,
      ...(onStdoutChunk ? { onStdoutChunk } : {}),
    });

    active = handle;

    if (cancelled) {
      requestQuit(handle);
    }

    try {
      return { result: await handle.exited, status: 'exited' };
    } finally {
      clearKillTimer();
      active = null;
    }
  };

  const result = (async (): Promise<ExportJobResult> => {
    // 先清掉上一次异常中断可能留下的同名临时产物，再开始本次导出。
    removeExportTempArtifacts(artifacts);

    try {
      const prepareError = prepareSubtitleArtifacts(plan);

      if (prepareError) {
        return { error: prepareError, ok: false };
      }

      if (cancelled) {
        return cancelledResult(currentPhase);
      }

      const premixOutcome = await runPhase('mixing', plan.premix);

      if (premixOutcome.status === 'cancelled' || cancelled) {
        return cancelledResult('mixing');
      }

      const premix = premixOutcome.result;

      if (premix.spawnError || premix.exitCode !== 0) {
        return failure(EXPORT_MESSAGES.premixFailed, premix.stderrTail);
      }

      if (fileSize(plan.premixTemporaryPath) <= 0) {
        return failure(EXPORT_MESSAGES.premixEmpty, premix.stderrTail);
      }

      const parser = createRenderProgressParser();
      const renderOutcome = await runPhase('rendering', plan.render, (chunk) => {
        for (const sample of parser.push(chunk)) {
          options.onProgress?.(sample);
        }
      });

      if (renderOutcome.status === 'cancelled' || cancelled) {
        return cancelledResult('rendering');
      }

      const render = renderOutcome.result;

      if (render.spawnError || render.exitCode !== 0) {
        return failure(EXPORT_MESSAGES.renderFailed, render.stderrTail);
      }

      if (fileSize(plan.temporaryPath) <= 0) {
        return failure(EXPORT_MESSAGES.renderEmpty, render.stderrTail);
      }

      // 取消可能发生在渲染退出与提交之间；取消永不提交。
      if (cancelled) {
        return cancelledResult('rendering');
      }

      currentPhase = 'committing';
      options.onPhase?.('committing');

      try {
        renameSync(plan.temporaryPath, plan.targetPath);
      } catch {
        return failure(EXPORT_MESSAGES.commitFailed, render.stderrTail);
      }

      return { ok: true, outputPath: plan.targetPath };
    } finally {
      // 预混音轨、字幕/字体与未提交的临时成品无论成败都要清理。
      // 成功提交后 temporaryPath 已 rename 成成品，这里的删除是 no-op。
      removeExportTempArtifacts(artifacts);
    }
  })();

  return { cancel, result };
}
