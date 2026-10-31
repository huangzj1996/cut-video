import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import type { WorkflowRunStatus } from '@miaoma/video-project';
import type {
  AppSettings,
  ExportDefaultTarget,
  ExportPhase,
  ExportProgress,
  ExportStartInput,
  ExportStartResult,
  ExportState,
} from '../../shared/ipc-contract';
import { IpcError } from '../ipc-error';
import { assertProjectId } from '../ipc-args';
import type { ProjectStore } from '../projects/project-store';
import { exportTempArtifactsFromPlan } from './artifacts';
import type { ExportFonts } from './fonts';
import { startExportJob, type ExportJobHandle } from './job';
import { EXPORT_MESSAGES } from './messages';
import { compileExportPlan, ExportPlanError, type ExportPlan } from './plan';
import { validateExportPreflight, type ExportPreflightDeps } from './preflight';
import { createEtaEstimator } from './progress';
import { runExportProcess, type ExportProcessRunner } from './runner';
import { assertExportTargetPath, buildDefaultExportTarget } from './target';
import {
  createExportTempWorkspace,
  resolveExportWorkspaceRoot,
  type ExportTempWorkspace,
} from './temp-workspace';

export interface ExportServiceMedia {
  ffmpegAvailable: boolean;
  ffmpegPath: string;
  /** 同步自检用它读取成片事实；缺失时自检 fail closed，不提交成品。 */
  ffprobePath: string;
}

export interface ExportServiceOptions {
  createRunner?: () => ExportProcessRunner;
  /** 系统临时目录根路径；用于登记本次导出的临时产物。默认 OS 临时目录。 */
  exportTempRoot?: string;
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
  ffprobePath: string;
  plan: ExportPlan;
  projectId: string;
  runId: string;
  startedAt: number;
  targetPath: string;
  workspace: ExportTempWorkspace | null;
}

/**
 * 导出任务服务：全局单任务，负责前置校验、编译计划、执行、进度广播与取消。
 * 渲染进程只通过 IPC 发起、取消与订阅；错误码统一使用 EXPORT_ 前缀。
 */
export class ExportService {
  private active: ActiveExport | null = null;
  private activeJob: ExportJobHandle | null = null;
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

  /** 当前是否有导出任务在跑；关窗确认用。 */
  hasActive(): boolean {
    return this.active !== null;
  }

  /** 关窗流程用：不校验 runId，直接请求取消当前任务。 */
  cancelActive(): void {
    if (this.active) {
      this.requestCancelActive();
    }
  }

  /**
   * 请求取消当前任务。start() 返回前 execute 已经创建好任务句柄，因此 IPC 能处理
   * cancel 时句柄必然存在；没有句柄说明任务已经收束，取消是 no-op。
   */
  private requestCancelActive(): void {
    this.activeJob?.cancel();
  }

  /**
   * 取消指定 runId 的导出；任务不存在或已结束时是 no-op。
   * 取消是异步收束的：先请求渲染进程优雅退出，超时强杀，期间状态事件继续推送。
   */
  cancel(rawRunId: unknown): null {
    if (typeof rawRunId !== 'string' || rawRunId.length === 0) {
      throw new IpcError('IPC_INVALID_ARGUMENT', '导出任务 ID 无效。');
    }

    if (!this.active || this.active.runId !== rawRunId) {
      return null;
    }

    this.requestCancelActive();
    return null;
  }

  /** 测试与关窗等待用：当前任务的 Promise；没有任务时立即完成。 */
  whenIdle(): Promise<void> {
    return this.active?.promise ?? Promise.resolve();
  }

  async start(rawInput: unknown): Promise<ExportStartResult> {
    const input = this.parseStartInput(rawInput);

    if (this.active) {
      throw new IpcError('EXPORT_ALREADY_RUNNING', EXPORT_MESSAGES.alreadyRunning);
    }

    const project = this.options.getProjectStore().get(input.projectId);
    const targetPath = assertExportTargetPath(input.targetPath);
    const media = this.options.media();
    const fonts = this.options.getExportFonts();
    // 前置校验是纯函数：草稿/只读/修订过期/能力边界/业务校验都在一处裁决。
    const preflightError = validateExportPreflight(
      {
        expectedRevision: input.expectedRevision,
        ffmpegAvailable: media.ffmpegAvailable,
        fonts,
        project,
        targetPath,
        workflowStatus: this.options.getWorkflowStatus(input.projectId),
      },
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

    // preflight 已经拦下草稿工程；这里再窄一次类型，供计划编译器安全使用。
    if (!('ai' in project)) {
      throw new IpcError('EXPORT_PROJECT_READONLY_OR_DRAFT', EXPORT_MESSAGES.draftProject);
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

    const workspace = this.createWorkspace(plan, runId);
    const startedAt = this.nowMs();

    this.emitState({
      phase: 'preparing',
      projectId: input.projectId,
      runId,
      status: 'running',
      targetPath,
    });

    const promise = this.execute({
      ffprobePath: media.ffprobePath,
      plan,
      projectId: input.projectId,
      runId,
      startedAt,
      targetPath,
      workspace,
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
    const estimator = createEtaEstimator({ totalDurationMs: input.plan.expected.durationMs });
    let lastPhase: ExportPhase = 'validating';
    let job: ExportJobHandle | null = null;

    const publish = (phase: ExportPhase): void => {
      lastPhase = phase;
      this.emitState({
        phase,
        projectId: input.projectId,
        runId: input.runId,
        status: 'running',
        targetPath: input.targetPath,
      });

      // 只有 rendering 阶段有真实百分比；mixing/verifying 等阶段不伪造进度。
      this.options.onProgress({
        elapsedMs: this.nowMs() - input.startedAt,
        etaMs: null,
        percent: null,
        phase,
        renderedMediaMs: null,
        runId: input.runId,
        speed: null,
      });
    };

    try {
      publish('validating');

      job = startExportJob({
        ffprobePath: input.ffprobePath,
        onPhase: publish,
        onProgress: (sample) => {
          const estimate = estimator.update(sample, {
            elapsedMs: this.nowMs() - input.startedAt,
          });

          this.options.onProgress({
            elapsedMs: this.nowMs() - input.startedAt,
            etaMs: estimate.etaMs,
            percent: estimate.percent,
            phase: 'rendering',
            renderedMediaMs: estimate.renderedMediaMs,
            runId: input.runId,
            speed: estimate.speed,
          });
        },
        plan: input.plan,
        runner,
      });

      this.activeJob = job;

      const result = await job.result;

      if (result.ok) {
        this.completed.set(input.runId, result.outputPath);
        this.emitState({
          outputPath: result.outputPath,
          phase: 'committing',
          projectId: input.projectId,
          runId: input.runId,
          status: 'succeeded',
          sync: result.sync.summary,
          targetPath: input.targetPath,
        });
        return;
      }

      if ('cancelled' in result) {
        this.emitState({
          error: { code: 'EXPORT_CANCELLED', message: EXPORT_MESSAGES.cancelled },
          phase: result.phase,
          projectId: input.projectId,
          runId: input.runId,
          status: 'cancelled',
          targetPath: input.targetPath,
        });
        return;
      }

      this.emitState({
        error: result.error,
        phase: lastPhase,
        projectId: input.projectId,
        runId: input.runId,
        status: 'failed',
        targetPath: input.targetPath,
      });
    } catch {
      // 意外异常也要确保渲染进程被请求退出，避免孤儿 ffmpeg。
      job?.cancel();
      this.emitState({
        error: { code: 'EXPORT_RENDER_FAILED', message: EXPORT_MESSAGES.unexpectedFailure },
        phase: lastPhase,
        projectId: input.projectId,
        runId: input.runId,
        status: 'failed',
        targetPath: input.targetPath,
      });
    } finally {
      if (job && this.activeJob === job) {
        this.activeJob = null;
      }

      input.workspace?.dispose();
    }
  }

  /**
   * 登记本次导出的临时产物：正常路径由任务清理，进程崩溃时由下次启动清理。
   * 登记失败只影响崩溃后的兜底清理，不应该阻止导出本身。
   */
  private createWorkspace(plan: ExportPlan, runId: string): ExportTempWorkspace | null {
    try {
      return createExportTempWorkspace({
        artifacts: exportTempArtifactsFromPlan(plan),
        createdAt: this.nowMs(),
        root: resolveExportWorkspaceRoot(this.options.exportTempRoot ?? os.tmpdir()),
        token: runId,
      });
    } catch {
      return null;
    }
  }

  private emitState(state: ExportState): void {
    this.options.onState(state);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private nowMs(): number {
    return this.now().getTime();
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
