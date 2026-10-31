import { rmSync } from 'node:fs';
import type { ExportPlan } from './plan';

/**
 * 一次导出产生的临时产物路径清单。
 *
 * 正常路径由导出任务清理；进程崩溃时由临时工作区的登记在下次启动时回收。
 * 清单与清理集中在这里，避免“新增一种临时产物要改三处”。
 */
export interface ExportTempArtifacts {
  /** 未提交的成品（<target>.partial）。 */
  partialPath: string;
  /** 预混音轨（<target>.partial.wav）。 */
  premixPath: string;
  /** 烧录字幕的 ASS 临时产物；不烧录字幕时没有。 */
  assPath?: string;
  /** 临时字体目录；不烧录字幕时没有。 */
  fontsDirPath?: string;
}

/** 从导出计划取出全部临时产物路径。 */
export function exportTempArtifactsFromPlan(plan: ExportPlan): ExportTempArtifacts {
  return {
    partialPath: plan.temporaryPath,
    premixPath: plan.premixTemporaryPath,
    ...(plan.subtitles
      ? { assPath: plan.subtitles.assPath, fontsDirPath: plan.subtitles.fontsDirPath }
      : {}),
  };
}

function removeFileQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // 清理失败只影响磁盘占用，不影响导出结果。
  }
}

function removeDirectoryQuietly(directory: string): void {
  try {
    rmSync(directory, { force: true, maxRetries: 3, recursive: true });
  } catch {
    // 同上。
  }
}

/** 删除清单里的全部临时产物；不存在的路径是 no-op。 */
export function removeExportTempArtifacts(artifacts: ExportTempArtifacts): void {
  removeFileQuietly(artifacts.partialPath);
  removeFileQuietly(artifacts.premixPath);

  if (artifacts.assPath !== undefined) {
    removeFileQuietly(artifacts.assPath);
  }

  if (artifacts.fontsDirPath !== undefined) {
    removeDirectoryQuietly(artifacts.fontsDirPath);
  }
}
