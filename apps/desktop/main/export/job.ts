import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { ExportErrorInfo, ExportPhase } from '../../shared/ipc-contract';
import type { ExportPlan } from './plan';
import type { ExportProcessRunner, ExportProcessResult } from './runner';

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

function removeDirectoryQuietly(directory: string): void {
  try {
    rmSync(directory, { force: true, maxRetries: 3, recursive: true });
  } catch {
    // 同上：临时字体目录清理失败只影响磁盘，不影响导出结果。
  }
}

function renderFailure(message: string): ExportJobResult {
  return { error: { code: 'EXPORT_RENDER_FAILED', message }, ok: false };
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
    return { code: 'EXPORT_RENDER_FAILED', message: '无法写入字幕临时文件，导出未开始。' };
  }

  try {
    mkdirSync(plan.subtitles.fontsDirPath, { recursive: true });

    for (const fontFile of plan.subtitles.fontFiles) {
      copyFileSync(fontFile, path.join(plan.subtitles.fontsDirPath, path.basename(fontFile)));
    }
  } catch {
    return { code: 'EXPORT_FONT_MISSING', message: '无法准备随包字幕字体，导出未开始。' };
  }

  return null;
}

/** 字幕属于临时产物：无论成功、失败还是取消都要清掉。 */
function cleanupSubtitleArtifacts(plan: ExportPlan): void {
  if (!plan.subtitles) {
    return;
  }

  removeQuietly(plan.subtitles.assPath);
  removeDirectoryQuietly(plan.subtitles.fontsDirPath);
}

/**
 * 执行一次导出任务：渲染到临时文件，成功且产物有效才提交。
 * 失败或取消都不提交，临时文件与字幕/字体产物必须清掉，保证“成功”只有一种含义。
 */
export async function runExportJob(options: ExportJobOptions): Promise<ExportJobResult> {
  const { plan, runner } = options;

  removeQuietly(plan.temporaryPath);

  const prepareError = prepareSubtitleArtifacts(plan);

  if (prepareError) {
    cleanupSubtitleArtifacts(plan);
    return { error: prepareError, ok: false };
  }

  options.onPhase?.('rendering');

  let processResult: ExportProcessResult;

  try {
    processResult = await runner({
      args: plan.ffmpeg.args,
      command: plan.ffmpeg.command,
      cwd: plan.cwd,
    });
  } finally {
    cleanupSubtitleArtifacts(plan);
  }

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
