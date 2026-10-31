import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import type { WorkflowRunStatus } from '@miaoma/video-project';
import type {
  AppSettings,
  ExportDefaultTarget,
  ExportErrorInfo,
  ExportPhase,
  ExportProgress,
  ExportStartInput,
  ExportStartResult,
  ExportState,
} from '../../shared/ipc-contract';
import { IpcError } from '../ipc-error';
import { assertProjectId } from '../ipc-args';
import type { ProjectStore } from '../projects/project-store';
import type { ExportFonts } from './fonts';
import { runExportJob } from './job';
import { compileExportPlan, ExportPlanError, type ExportPlan } from './plan';
import { validateExportPreflight, type ExportPreflightDeps } from './preflight';
import { runExportProcess, type ExportProcessRunner } from './runner';
import { assertExportTargetPath, buildDefaultExportTarget } from './target';

export interface ExportServiceMedia {
  ffmpegAvailable: boolean;
  ffmpegPath: string;
}

export interface ExportServiceOptions {
  createRunner?: () => ExportProcessRunner;
  /** 随包字体；缺失时返回 null，前置校验据此报 EXPORT_FONT_MISSING。 */
  getExportFonts: () => ExportFonts | null;
  getProjectStore: () => ProjectStore;
  getSettings: () => AppSettings;
  getWorkflowStatus: (projectId: string) => WorkflowRunStatus | null;
  media: () => ExportServiceMedia;
  now?: () => Date;
  onProgress: (progress: ExportProgress) => void;
  onState: (state: ExportState) => void;
  preflightDeps?: ExportPreflightDeps;
}

interface ActiveExport {
  projectId: string;
  promise: Promise<void>;
  runId: string;
  targetPath: string;
}

interface ExecuteExportInput {
  plan: ExportPlan;
  projectId: string;
  runId: string;
  startedAt: number;
  targetPath: string;
}

/**
 * 导出任务服务：全局单任务，负责前置校验、编译计划、执行与状态广播。
 * 渲染进程只通过 IPC 发起与订阅；错误码统一使用 EXPORT_ 前缀。
 */
export class ExportService {
  private active: ActiveExport | null = null;
  private readonly completed = new Map<string, string>();

  constructor(private readonly options: ExportServiceOptions) {}

  getDefaultTarget(projectId: string): ExportDefaultTarget {
    const id = assertProjectId(projectId);
    const project = this.options.getProjectStore().get(id);
    const settings = this.options.getSettings();
    const target = buildDefaultExportTarget({
      exists: existsSync,
      now: this.now(),
      projectName: project.project.name,
      projectRoot: settings.defaultProjectDirectory,
    });

    // 默认导出目录可能还不存在；创建失败时不在这里抛错，交给前置校验给出可写提示。
    try {
      mkdirSync(target.directory, { recursive: true });
    } catch {
      // 忽略；preflight 会返回 EXPORT_TARGET_UNWRITABLE。
    }

    return target;
  }

  getOutputPath(runId: unknown): string {
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new IpcError('IPC_INVALID_ARGUMENT', '导出任务 ID 无效。');
    }

    const outputPath = this.completed.get(runId);

    if (!outputPath) {
      throw new IpcError('IPC_INVALID_ARGUMENT', '导出任务不存在或尚未完成。');
    }

    return outputPath;
  }

  /** 测试与关窗等待用：当前任务的 Promise；没有任务时立即完成。 */
  whenIdle(): Promise<void> {
    return this.active?.promise ?? Promise.resolve();
  }

  async start(rawInput: unknown): Promise<ExportStartResult> {
    const input = this.parseStartInput(rawInput);

    if (this.active) {
      throw new IpcError('EXPORT_ALREADY_RUNNING', '已有导出任务正在进行中。');
    }

    const project = this.options.getProjectStore().get(input.projectId);

    if (!('ai' in project)) {
      throw new IpcError('EXPORT_PROJECT_READONLY_OR_DRAFT', '草稿工程不能导出。');
    }

    const workflowStatus = this.options.getWorkflowStatus(input.projectId);

    if (workflowStatus === 'running' || workflowStatus === 'waiting_user') {
      throw new IpcError(
        'EXPORT_PROJECT_READONLY_OR_DRAFT',
        'AI 工作流正在运行或等待审批，暂不能导出。',
      );
    }

    if (project.project.contentRevision !== input.expectedRevision) {
      throw new IpcError('EXPORT_PROJECT_STALE', '工程内容已更新，请重新打开导出。');
    }

    const targetPath = assertExportTargetPath(input.targetPath);
    const media = this.options.media();
    const fonts = this.options.getExportFonts();
    const preflightError = validateExportPreflight(
      { ffmpegAvailable: media.ffmpegAvailable, fonts, project, targetPath },
      {
        ...this.options.preflightDeps,
        now: this.options.preflightDeps?.now ?? (() => this.now()),
      },
    );

    if (preflightError) {
      throw new IpcError(
        preflightError.code,
        preflightError.message,
        false,
        preflightError.issues ? { issues: preflightError.issues } : undefined,
      );
    }

    const runId = randomUUID();
    let plan: ExportPlan;

    try {
      plan = compileExportPlan({
        artifactToken: runId,
        ffmpegPath: media.ffmpegPath,
        fonts,
        project,
        targetPath,
      });
    } catch (error) {
      if (error instanceof ExportPlanError) {
        throw new IpcError('EXPORT_VALIDATION_FAILED', error.message);
      }

      throw error;
    }
    const startedAt = Date.now();

    this.emitState({
      phase: 'preparing',
      projectId: input.projectId,
      runId,
      status: 'running',
      targetPath,
    });

    const promise = this.execute({
      plan,
      projectId: input.projectId,
      runId,
      startedAt,
      targetPath,
    }).finally(() => {
      if (this.active?.runId === runId) {
        this.active = null;
      }
    });

    this.active = { projectId: input.projectId, promise, runId, targetPath };

    return { runId, targetPath };
  }

  private async execute(input: ExecuteExportInput): Promise<void> {
    const runner = this.options.createRunner?.() ?? runExportProcess;
    let lastPhase: ExportPhase = 'validating';

    const publish = (phase: ExportPhase): void => {
      lastPhase = phase;
      this.emitState({
        phase,
        projectId: input.projectId,
        runId: input.runId,
        status: 'running',
        targetPath: input.targetPath,
      });
      this.options.onProgress({
        elapsedMs: Date.now() - input.startedAt,
        etaMs: null,
        percent: null,
        phase,
        renderedMediaMs: null,
        runId: input.runId,
        speed: null,
      });
    };

    publish('validating');

    let error: ExportErrorInfo;

    try {
      const result = await runExportJob({
        onPhase: publish,
        plan: input.plan,
        runner,
      });

      if (result.ok) {
        this.completed.set(input.runId, result.outputPath);
        this.emitState({
          outputPath: result.outputPath,
          phase: 'committing',
          projectId: input.projectId,
          runId: input.runId,
          status: 'succeeded',
          targetPath: input.targetPath,
        });
        return;
      }

      error = result.error;
    } catch {
      error = { code: 'EXPORT_RENDER_FAILED', message: '导出过程异常中止，未提交成品。' };
    }

    this.emitState({
      error,
      phase: lastPhase,
      projectId: input.projectId,
      runId: input.runId,
      status: 'failed',
      targetPath: input.targetPath,
    });
  }

  private emitState(state: ExportState): void {
    this.options.onState(state);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private parseStartInput(rawInput: unknown): ExportStartInput {
    if (rawInput === null || typeof rawInput !== 'object') {
      throw new IpcError('IPC_INVALID_ARGUMENT', '导出参数无效。');
    }

    const input = rawInput as {
      expectedRevision?: unknown;
      projectId?: unknown;
      targetPath?: unknown;
    };
    const projectId = assertProjectId(input.projectId);

    if (
      typeof input.expectedRevision !== 'number' ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    ) {
      throw new IpcError('IPC_INVALID_ARGUMENT', '工程修订号无效。');
    }

    if (typeof input.targetPath !== 'string' || input.targetPath.trim().length === 0) {
      throw new IpcError('IPC_INVALID_ARGUMENT', '导出位置无效。');
    }

    return {
      expectedRevision: input.expectedRevision,
      projectId,
      targetPath: input.targetPath,
    };
  }
}
