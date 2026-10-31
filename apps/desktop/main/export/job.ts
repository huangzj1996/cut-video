import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import type { ExportErrorInfo, ExportPhase } from '../../shared/ipc-contract';
import type { ExportPlan } from './plan';
import type { ExportProcessRunner } from './runner';

export interface ExportJobOptions {
  onPhase?: (phase: ExportPhase) => void;
  plan: ExportPlan;
  runner: ExportProcessRunner;
}

export type ExportJobResult =
  { ok: true; outputPath: string } | { error: ExportErrorInfo; ok: false };

function removeQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // 清理失败不能掩盖导出本身的失败原因。
  }
}

function renderFailure(message: string): ExportJobResult {
  return { error: { code: 'EXPORT_RENDER_FAILED', message }, ok: false };
}

/**
 * 执行一次导出任务：渲染到临时文件，成功且产物有效才提交。
 * 失败或取消都不提交，临时文件必须清掉，保证“成功”只有一种含义。
 */
export async function runExportJob(options: ExportJobOptions): Promise<ExportJobResult> {
  const { plan, runner } = options;

  removeQuietly(plan.temporaryPath);
  options.onPhase?.('rendering');

  const processResult = await runner({
    args: plan.ffmpeg.args,
    command: plan.ffmpeg.command,
  });

  if (processResult.spawnError || processResult.exitCode !== 0) {
    removeQuietly(plan.temporaryPath);
    return renderFailure('渲染进程失败，导出未完成。');
  }

  let size = 0;

  try {
    size = existsSync(plan.temporaryPath) ? statSync(plan.temporaryPath).size : 0;
  } catch {
    // 读不到大小按无产物处理。
  }

  if (size <= 0) {
    removeQuietly(plan.temporaryPath);
    return renderFailure('渲染没有产出有效文件，导出未完成。');
  }

  options.onPhase?.('committing');

  try {
    renameSync(plan.temporaryPath, plan.targetPath);
  } catch {
    removeQuietly(plan.temporaryPath);
    return renderFailure('无法提交导出成品，请检查保存位置。');
  }

  return { ok: true, outputPath: plan.targetPath };
}
