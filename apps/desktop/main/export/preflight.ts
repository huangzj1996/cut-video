import { accessSync, constants, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateProject } from '@miaoma/video-agent/workflow';
import type { ValidationIssue, ValidationReport, VideoProject } from '@miaoma/video-project';
import type { ExportErrorInfo, ExportIssue } from '../../shared/ipc-contract';

const MAX_REPORTED_ISSUES = 20;

export interface ExportPreflightDeps {
  isDirectoryWritable?: (directory: string) => boolean;
  now?: () => Date;
  validate?: (project: VideoProject, nowIso: string) => ValidationReport;
}

export interface ExportPreflightInput {
  ffmpegAvailable: boolean;
  project: VideoProject;
  targetPath: string;
}

function defaultIsDirectoryWritable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function toExportIssue(issue: ValidationIssue): ExportIssue {
  return {
    code: issue.code,
    message: issue.message,
    ...(issue.assetId !== undefined ? { assetId: issue.assetId } : {}),
    ...(issue.clipId !== undefined ? { clipId: issue.clipId } : {}),
    ...(issue.fieldPath !== undefined ? { fieldPath: issue.fieldPath } : {}),
    ...(issue.sceneId !== undefined ? { sceneId: issue.sceneId } : {}),
  };
}

/**
 * 导出前置校验：重新执行既有业务校验，并检查导出本身的前置条件。
 * 任一 error 都返回结构化问题列表，调用方据此阻止导出；不提供忽略继续。
 */
export function validateExportPreflight(
  input: ExportPreflightInput,
  deps: ExportPreflightDeps = {},
): ExportErrorInfo | null {
  if (!input.ffmpegAvailable) {
    return { code: 'EXPORT_RENDER_FAILED', message: '未找到 FFmpeg，无法导出。' };
  }

  const directory = path.dirname(input.targetPath);
  const isDirectoryWritable = deps.isDirectoryWritable ?? defaultIsDirectoryWritable;

  if (!existsSync(directory) || !isDirectoryWritable(directory)) {
    return { code: 'EXPORT_TARGET_UNWRITABLE', message: '导出位置不可写，请选择其他文件夹。' };
  }

  if (existsSync(input.targetPath)) {
    try {
      if (statSync(input.targetPath).isDirectory()) {
        return {
          code: 'EXPORT_TARGET_UNWRITABLE',
          message: '导出位置是文件夹，请选择一个 .mp4 文件路径。',
        };
      }
    } catch {
      return { code: 'EXPORT_TARGET_UNWRITABLE', message: '无法访问导出位置，请选择其他文件夹。' };
    }
  }

  const validate = deps.validate ?? validateProject;
  const now = deps.now?.() ?? new Date();
  const report = validate(input.project, now.toISOString());

  if (report.passed) {
    return null;
  }

  return {
    code: 'EXPORT_VALIDATION_FAILED',
    issues: report.errors.slice(0, MAX_REPORTED_ISSUES).map(toExportIssue),
    message: '导出前校验未通过，请先修复以下问题。',
  };
}
