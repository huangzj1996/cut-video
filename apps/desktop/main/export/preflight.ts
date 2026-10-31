import { accessSync, constants, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateProject } from '@miaoma/video-agent/workflow';
import type {
  StoredProject,
  ValidationIssue,
  ValidationReport,
  VideoAsset,
  VideoClip,
  VideoProject,
  WorkflowRunStatus,
} from '@miaoma/video-project';
import type { ExportErrorInfo, ExportIssue } from '../../shared/ipc-contract';
import { findVideoCapabilityProblem } from '../../shared/video-capabilities';
import { isWorkflowReadonly } from '../../shared/workflow-status';
import type { ExportFonts } from './fonts';
import { EXPORT_MESSAGES, exportCapabilityMessage } from './messages';
import { sortedVideoClips } from './project-clips';

const MAX_REPORTED_ISSUES = 20;
const DEFAULT_CROP = { height: 1, width: 1, x: 0, y: 0 } as const;
const DEFAULT_TRANSFORM = { scale: 1, x: 0, y: 0 } as const;
const VALUE_EPSILON = 1e-9;

export interface ExportPreflightDeps {
  isDirectoryWritable?: (directory: string) => boolean;
  now?: () => Date;
  validate?: (project: VideoProject, nowIso: string) => ValidationReport;
}

export interface ExportPreflightInput {
  /** 发起导出时渲染进程看到的修订；与当前修订不一致即为过期。 */
  expectedRevision: number;
  ffmpegAvailable: boolean;
  /** 随包字体；null 表示字体缺失，导出必须先被拦下。 */
  fonts: ExportFonts | null;
  /** 当前工程；草稿工程没有 `ai`，不能导出。 */
  project: StoredProject;
  targetPath: string;
  /** 工作流运行/等待审批时工程只读。 */
  workflowStatus: WorkflowRunStatus | null;
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

function videosById(project: VideoProject): Map<string, VideoAsset> {
  return new Map(project.assets.videos.map((asset) => [asset.id, asset]));
}

/**
 * v1 不支持的素材：HEVC 等非 H.264 编码、HDR、VFR。
 * 每个受影响的片段单独报一条，保留素材/片段/分镜定位。
 */
function unsupportedMediaIssues(project: VideoProject): ExportIssue[] {
  const assets = videosById(project);
  const issues: ExportIssue[] = [];

  for (const clip of sortedVideoClips(project)) {
    const asset = assets.get(clip.assetId);

    if (!asset) {
      continue;
    }

    const problem = findVideoCapabilityProblem(asset);

    if (!problem) {
      continue;
    }

    issues.push({
      assetId: asset.id,
      clipId: clip.id,
      code: 'EXPORT_UNSUPPORTED_MEDIA',
      message: exportCapabilityMessage(problem),
      ...(clip.sceneId !== undefined ? { sceneId: clip.sceneId } : {}),
    });
  }

  return issues;
}

function reportableIssues<T>(issues: readonly T[]): T[] {
  return issues.slice(0, MAX_REPORTED_ISSUES);
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= VALUE_EPSILON;
}

function isDefaultCrop(crop: VideoClip['crop']): boolean {
  return (
    near(crop.height, DEFAULT_CROP.height) &&
    near(crop.width, DEFAULT_CROP.width) &&
    near(crop.x, DEFAULT_CROP.x) &&
    near(crop.y, DEFAULT_CROP.y)
  );
}

function isDefaultTransform(transform: VideoClip['transform']): boolean {
  return (
    near(transform.scale, DEFAULT_TRANSFORM.scale) &&
    near(transform.x, DEFAULT_TRANSFORM.x) &&
    near(transform.y, DEFAULT_TRANSFORM.y)
  );
}

/**
 * v1 只实现默认 crop/transform；非默认变换必须显式阻断，不能被静默忽略。
 */
function unsupportedTransformIssues(project: VideoProject): ExportIssue[] {
  const issues: ExportIssue[] = [];

  for (const clip of sortedVideoClips(project)) {
    const base = {
      assetId: clip.assetId,
      clipId: clip.id,
      code: 'EXPORT_UNSUPPORTED_TRANSFORM' as const,
      ...(clip.sceneId !== undefined ? { sceneId: clip.sceneId } : {}),
    };

    if (!isDefaultCrop(clip.crop)) {
      issues.push({
        ...base,
        fieldPath: 'crop',
        message: EXPORT_MESSAGES.unsupportedCrop,
      });
    }

    if (!isDefaultTransform(clip.transform)) {
      issues.push({
        ...base,
        fieldPath: 'transform',
        message: EXPORT_MESSAGES.unsupportedTransformClip,
      });
    }
  }

  return issues;
}

/**
 * 导出前置校验：一次调用只裁决一次，不缓存、不复用上一次的通过报告。
 * 目标目录可写性与业务校验通过 deps 注入，夹具单测不需要真实磁盘布局。
 *
 * 顺序：工程状态（草稿/只读/修订过期）→ 运行环境（FFmpeg/字体/目标目录）
 * → 内容能力边界（素材编码、crop/transform）→ 对当前修订重跑业务校验。
 * 任一 error 都返回结构化问题列表，调用方据此阻止导出；不提供“忽略继续”。
 */
export function validateExportPreflight(
  input: ExportPreflightInput,
  deps: ExportPreflightDeps = {},
): ExportErrorInfo | null {
  const { project } = input;

  if (!('ai' in project)) {
    return { code: 'EXPORT_PROJECT_READONLY_OR_DRAFT', message: EXPORT_MESSAGES.draftProject };
  }

  if (isWorkflowReadonly(input.workflowStatus)) {
    return {
      code: 'EXPORT_PROJECT_READONLY_OR_DRAFT',
      message: EXPORT_MESSAGES.workflowReadonly,
    };
  }

  if (project.project.contentRevision !== input.expectedRevision) {
    return { code: 'EXPORT_PROJECT_STALE', message: EXPORT_MESSAGES.staleRevision };
  }

  if (!input.ffmpegAvailable) {
    return { code: 'EXPORT_RENDER_FAILED', message: EXPORT_MESSAGES.ffmpegMissing };
  }

  // 随包字体是烧录字幕的前提：缺失时明确报错，不让 ffmpeg 静默回退到系统字体。
  if (!input.fonts || input.fonts.files.length === 0) {
    return { code: 'EXPORT_FONT_MISSING', message: EXPORT_MESSAGES.fontMissing };
  }

  const directory = path.dirname(input.targetPath);
  const isDirectoryWritable = deps.isDirectoryWritable ?? defaultIsDirectoryWritable;

  if (!existsSync(directory) || !isDirectoryWritable(directory)) {
    return { code: 'EXPORT_TARGET_UNWRITABLE', message: EXPORT_MESSAGES.targetUnwritable };
  }

  if (existsSync(input.targetPath)) {
    try {
      if (statSync(input.targetPath).isDirectory()) {
        return { code: 'EXPORT_TARGET_UNWRITABLE', message: EXPORT_MESSAGES.targetIsDirectory };
      }
    } catch {
      return { code: 'EXPORT_TARGET_UNWRITABLE', message: EXPORT_MESSAGES.targetInaccessible };
    }
  }

  // 能力问题合并成一次返回，避免“先修素材、再改裁剪”地反复试错；
  // 顶层错误码按素材优先归类，逐条 issue 仍保留自己的错误码与定位。
  const mediaIssues = unsupportedMediaIssues(project);
  const transformIssues = unsupportedTransformIssues(project);
  const capabilityIssues = reportableIssues([...mediaIssues, ...transformIssues]);

  if (capabilityIssues.length > 0) {
    return mediaIssues.length > 0
      ? {
          code: 'EXPORT_UNSUPPORTED_MEDIA',
          issues: capabilityIssues,
          message:
            transformIssues.length > 0
              ? EXPORT_MESSAGES.unsupportedMediaOrTransform
              : EXPORT_MESSAGES.unsupportedMedia,
        }
      : {
          code: 'EXPORT_UNSUPPORTED_TRANSFORM',
          issues: capabilityIssues,
          message: EXPORT_MESSAGES.unsupportedTransform,
        };
  }

  const validate = deps.validate ?? validateProject;
  const now = deps.now?.() ?? new Date();
  // 每次都按当前修订重跑；旧的通过报告不会被复用（修订变化已在上方拦下）。
  const report = validate(project, now.toISOString());

  if (report.passed) {
    return null;
  }

  return {
    code: 'EXPORT_VALIDATION_FAILED',
    issues: reportableIssues(report.errors).map(toExportIssue),
    message: EXPORT_MESSAGES.validationFailed,
  };
}
