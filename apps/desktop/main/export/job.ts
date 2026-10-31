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

function fileSize(filePath: string): number {
  try {
    return existsSync(filePath) ? statSync(filePath).size : 0;
  } catch {
    // 读不到大小按无产物处理。
    return 0;
  }
}

function failure(message: string): ExportJobResult {
  return { error: { code: 'EXPORT_RENDER_FAILED', message }, ok: false };
}

/**
 * 执行一次两段式导出：先预混音轨，再单遍视频编码并封装，成功且产物有效才提交。
 * 预混音轨与临时成品都是临时产物：成功、失败、取消都要清理；
 * 任何失败都不提交，保证“成功”只有一种含义。
 */
export async function runExportJob(options: ExportJobOptions): Promise<ExportJobResult> {
  const { plan, runner } = options;
  let committed = false;

  removeQuietly(plan.temporaryPath);
  removeQuietly(plan.premixTemporaryPath);

  try {
    options.onPhase?.('mixing');

    const premixResult = await runner({
      args: plan.premix.args,
      command: plan.premix.command,
    });

    if (premixResult.spawnError || premixResult.exitCode !== 0) {
      return failure('预混音轨失败，导出未完成。');
    }

    if (fileSize(plan.premixTemporaryPath) <= 0) {
      return failure('预混音轨没有产出有效音轨，导出未完成。');
    }

    options.onPhase?.('rendering');

    const processResult = await runner({
      args: plan.render.args,
      command: plan.render.command,
    });

    if (processResult.spawnError || processResult.exitCode !== 0) {
      return failure('渲染进程失败，导出未完成。');
    }

    if (fileSize(plan.temporaryPath) <= 0) {
      return failure('渲染没有产出有效文件，导出未完成。');
    }

    options.onPhase?.('committing');

    try {
      renameSync(plan.temporaryPath, plan.targetPath);
    } catch {
      return failure('无法提交导出成品，请检查保存位置。');
    }

    committed = true;
    return { ok: true, outputPath: plan.targetPath };
  } finally {
    // 预混音轨无论成败都要清理；未提交的临时成品同理。
    removeQuietly(plan.premixTemporaryPath);

    if (!committed) {
      removeQuietly(plan.temporaryPath);
    }
  }
}
