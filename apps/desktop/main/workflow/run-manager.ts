import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { LlmError, type LlmProvider } from '@miaoma/video-agent/llm';
import {
  createInitialWorkflowState,
  toSafeWorkflowError,
  type PromptProvider,
  type WorkflowRuntime,
} from '@miaoma/video-agent/workflow';
import {
  WORKFLOW_PHASES,
  WorkflowNodeIdSchema,
  WorkflowPhaseStatusSchema,
  WorkflowRunStatusSchema,
  createEmptyPhaseStatus,
  type ApprovalGate,
  type ApprovalInterruptPayload,
  type RunEvent,
  type RunEventError,
  type WorkflowNodeId,
  type WorkflowPhaseStatus,
  type WorkflowRunStatus,
} from '@miaoma/video-project';
import {
  ApprovalGateSchema,
  ApprovalInterruptPayloadSchema,
  IsoDateSchema,
  RunEventErrorSchema,
  RunEventSchema,
} from '@miaoma/video-project';
import { IpcError } from '../ipc-error';
import type { ProjectStore } from '../projects/project-store';
import { createWorkflowComposition, type WorkflowComposition } from './composition';

const RUN_RECORD_SCHEMA_VERSION = '1.0.0' as const;

const RunRecordSchema = z.strictObject({
  schemaVersion: z.literal(RUN_RECORD_SCHEMA_VERSION),
  runId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(300),
  status: WorkflowRunStatusSchema,
  startedAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lastEventSeq: z.number().int().nonnegative(),
  currentNodeId: WorkflowNodeIdSchema.nullable(),
  completedNodes: z.array(WorkflowNodeIdSchema).max(10),
  phaseStatus: WorkflowPhaseStatusSchema,
  pendingGate: ApprovalGateSchema.optional(),
  pendingApproval: ApprovalInterruptPayloadSchema.optional(),
  error: RunEventErrorSchema.optional(),
});

export type WorkflowRunRecord = z.infer<typeof RunRecordSchema>;

export interface WorkflowPublicState {
  runId: string;
  status: WorkflowRunStatus;
  phaseStatus: WorkflowPhaseStatus;
  currentNodeId: WorkflowNodeId | null;
  pendingGate?: ApprovalGate;
  pendingApproval?: ApprovalInterruptPayload;
  saved: boolean;
  contentRevision: number;
  lastEventSeq: number;
  error?: RunEventError;
}

export interface WorkflowRunManagerOptions {
  getProjectStore: () => ProjectStore;
  getLlmProvider: () => LlmProvider;
  prompts: PromptProvider;
  media: {
    isPackaged: boolean;
    appPath: string;
    resourcesPath: string;
  };
}

interface ActiveRun {
  runId: string;
  controller: AbortController;
  promise: Promise<void>;
}

function asRecordError(error: unknown): RunEventError {
  return toSafeWorkflowError(error);
}

/**
 * 主进程 run 生命周期：
 * - start/resume 在后台执行，IPC 立即返回；
 * - 每个事件先追加 events.jsonl、更新 run.json，再广播；
 * - 关闭重开后 recover 把 running 标记为 interrupted，不自动重跑模型。
 */
export class WorkflowRunManager extends EventEmitter {
  private readonly active = new Map<string, ActiveRun>();
  private readonly records = new Map<string, WorkflowRunRecord>();
  private readonly runtimes = new Map<string, WorkflowRuntime>();

  constructor(private readonly options: WorkflowRunManagerOptions) {
    super();
  }

  async start(projectId: string): Promise<WorkflowPublicState> {
    const existing = this.active.get(projectId);

    if (existing) {
      return this.toPublicState(this.requireRecord(projectId));
    }

    const previous = this.records.get(projectId) ?? this.readLatestRecord(projectId);

    if (previous) {
      this.records.set(projectId, previous);
      return this.toPublicState(previous);
    }

    return this.toPublicState(this.launchRun(projectId));
  }

  /**
   * 创作完成后继续补充要求：创建一轮新 run，把用户输入作为 briefFeedback，
   * 从素材扫描重新走完整流水线；旧 run 的消息与产物保留在工程目录。
   */
  async startFollowUp(projectId: string, feedback: string): Promise<WorkflowPublicState> {
    const active = this.active.get(projectId);
    const current = this.records.get(projectId);

    if (active) {
      // run.completed 消息可能先于 runtime promise 的收尾到达；等它结束再开新 run。
      if (
        current &&
        (current.status === 'succeeded' ||
          current.status === 'failed' ||
          current.status === 'cancelled')
      ) {
        await active.promise;
      } else {
        throw new IpcError('WORKFLOW_BUSY', '工作流正在执行中。', true);
      }
    }

    return this.toPublicState(this.launchRun(projectId, { briefFeedback: feedback }));
  }

  private launchRun(
    projectId: string,
    options: { briefFeedback?: string } = {},
  ): WorkflowRunRecord {
    const store = this.options.getProjectStore();
    const project = store.get(projectId);
    store.readCreationInput(projectId);
    const provider = this.createProvider();
    const runId = randomUUID();
    const now = new Date().toISOString();
    const record: WorkflowRunRecord = {
      schemaVersion: RUN_RECORD_SCHEMA_VERSION,
      runId,
      projectId,
      threadId: `${projectId}:${runId}`,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      lastEventSeq: 0,
      currentNodeId: null,
      completedNodes: [],
      phaseStatus: createEmptyPhaseStatus(),
    };

    this.records.set(projectId, record);
    this.persistRecord(record);

    const controller = new AbortController();
    const composition = this.createComposition(
      projectId,
      runId,
      project.project.contentRevision,
      provider,
      controller,
      0,
    );
    this.runtimes.set(this.runtimeKey(projectId, runId), composition.runtime);

    const promise = composition.runtime
      .start(
        createInitialWorkflowState({
          projectId,
          runId,
          contentRevision: project.project.contentRevision,
          creationInputRef: null,
          ...(options.briefFeedback !== undefined ? { briefFeedback: options.briefFeedback } : {}),
        }),
      )
      .then((snapshot) => this.finish(record, snapshot))
      .catch((error) => this.fail(record, error))
      .finally(() => {
        if (this.active.get(projectId)?.promise === promise) {
          this.active.delete(projectId);
        }
        this.runtimes.delete(this.runtimeKey(projectId, runId));
      });

    this.active.set(projectId, { runId, controller, promise });

    return record;
  }

  async resume(
    projectId: string,
    runId: string,
    decision?: Parameters<WorkflowRuntime['resume']>[0],
  ): Promise<WorkflowPublicState> {
    const record = this.records.get(projectId) ?? this.readLatestRecord(projectId);

    if (!record || record.runId !== runId) {
      throw new IpcError('WORKFLOW_NOT_FOUND', '工作流运行不存在。');
    }

    const active = this.active.get(projectId);

    if (active) {
      // node.waiting_user 事件先于 runtime.start 的 Promise 收尾；等待它完成
      // 再开始 resume，避免 finish() 覆盖新 run 的状态。
      if (record.status === 'waiting_user') {
        await active.promise;
      } else {
        throw new IpcError('WORKFLOW_BUSY', '工作流正在执行中。', true);
      }
    }

    const resumable =
      record.status === 'waiting_user' ||
      record.status === 'failed' ||
      record.status === 'interrupted';

    if (!resumable) {
      throw new IpcError('WORKFLOW_NOT_FOUND', '当前运行不能继续。');
    }

    if (record.status === 'waiting_user' && !decision) {
      throw new IpcError('WORKFLOW_APPROVAL_REQUIRED', '当前审批尚未回复。');
    }

    const provider = this.createProvider();
    const project = this.options.getProjectStore().get(projectId);
    record.status = 'running';
    record.updatedAt = new Date().toISOString();
    delete record.error;
    this.persistRecord(record);
    this.records.set(projectId, record);

    const controller = new AbortController();
    const composition = this.createComposition(
      projectId,
      runId,
      project.project.contentRevision,
      provider,
      controller,
      record.lastEventSeq,
    );
    this.runtimes.set(this.runtimeKey(projectId, runId), composition.runtime);

    const promise = composition.runtime
      .resume(decision)
      .then((snapshot) => this.finish(record, snapshot))
      .catch((error) => this.fail(record, error))
      .finally(() => {
        if (this.active.get(projectId)?.promise === promise) {
          this.active.delete(projectId);
        }
        this.runtimes.delete(this.runtimeKey(projectId, runId));
      });

    this.active.set(projectId, { runId, controller, promise });

    return this.toPublicState(record);
  }

  async cancel(projectId: string, runId: string): Promise<WorkflowPublicState> {
    const record = this.records.get(projectId) ?? this.readLatestRecord(projectId);

    if (!record || record.runId !== runId) {
      throw new IpcError('WORKFLOW_NOT_FOUND', '工作流运行不存在。');
    }

    const active = this.active.get(projectId);

    if (active && active.runId === runId) {
      active.controller.abort();
      return this.toPublicState(record);
    }

    if (record.status === 'waiting_user') {
      this.emitSynthetic(record, {
        type: 'run.cancelled',
        status: 'cancelled',
      });
    }

    return this.toPublicState(record);
  }

  getState(projectId: string): WorkflowPublicState | undefined {
    const record = this.records.get(projectId) ?? this.readLatestRecord(projectId);

    if (!record) {
      return undefined;
    }

    this.records.set(projectId, record);
    return this.toPublicState(record);
  }

  getRecord(projectId: string): WorkflowRunRecord | undefined {
    return this.records.get(projectId) ?? this.readLatestRecord(projectId) ?? undefined;
  }

  readEvents(projectId: string, runId?: string): RunEvent[] {
    const record = runId
      ? this.records.get(projectId)?.runId === runId
        ? this.records.get(projectId)
        : this.readRecord(projectId, runId)
      : (this.records.get(projectId) ?? this.readLatestRecord(projectId));

    if (!record) {
      return [];
    }

    const filePath = path.join(this.projectRunDirectory(record), 'events.jsonl');

    if (!existsSync(filePath)) {
      return [];
    }

    const events: RunEvent[] = [];

    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const parsed = RunEventSchema.safeParse(JSON.parse(line));

        if (parsed.success) {
          events.push(parsed.data);
        }
      } catch {
        // 跳过损坏/半截的最后一行。
      }
    }

    return events;
  }

  recover(): void {
    let summaries: ReturnType<ProjectStore['list']>;

    try {
      summaries = this.options.getProjectStore().list();
    } catch {
      return;
    }

    for (const summary of summaries) {
      const record = this.readLatestRecord(summary.projectId);

      if (!record) {
        continue;
      }

      if (record.status === 'running') {
        record.status = 'interrupted';
        record.updatedAt = new Date().toISOString();
        this.persistRecord(record);
      }

      this.records.set(summary.projectId, record);
    }
  }

  private createProvider(): LlmProvider {
    try {
      return this.options.getLlmProvider();
    } catch (error) {
      if (error instanceof LlmError && error.code === 'LLM_CONFIG_MISSING_API_KEY') {
        throw new IpcError('LLM_NOT_CONFIGURED', error.message, false);
      }

      throw new IpcError('LLM_NOT_CONFIGURED', '模型配置无效。', false);
    }
  }

  private createComposition(
    projectId: string,
    runId: string,
    contentRevision: number,
    provider: LlmProvider,
    controller: AbortController,
    initialEventSeq: number,
  ): WorkflowComposition {
    const record = this.requireRecord(projectId);

    return createWorkflowComposition({
      projectId,
      runId,
      contentRevision,
      projectStore: this.options.getProjectStore(),
      llmProvider: provider,
      prompts: this.options.prompts,
      signal: controller.signal,
      initialEventSeq,
      media: this.options.media,
      onEvent: (event) => this.handleEvent(record, event),
      onStream: (event) => this.emit('stream', event),
    });
  }

  private handleEvent(record: WorkflowRunRecord, event: RunEvent): void {
    const runDirectory = this.projectRunDirectory(record);
    mkdirSync(runDirectory, { recursive: true });
    appendFileSync(path.join(runDirectory, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');

    record.lastEventSeq = Math.max(record.lastEventSeq, event.seq);
    record.updatedAt = event.timestamp;

    switch (event.type) {
      case 'run.started':
      case 'run.resumed':
        record.status = 'running';
        delete record.pendingGate;
        delete record.pendingApproval;
        delete record.error;
        break;
      case 'node.started':
        record.status = 'running';
        record.currentNodeId = event.nodeId ?? record.currentNodeId;

        if (event.phase) {
          record.phaseStatus = {
            ...record.phaseStatus,
            [event.phase]: 'running',
          };
        }
        break;
      case 'node.waiting_user':
        record.status = 'waiting_user';
        record.currentNodeId = event.nodeId ?? record.currentNodeId;

        if (event.approval) {
          record.pendingGate = event.approval.gate;
          record.pendingApproval = event.approval;
        }

        if (event.phase) {
          record.phaseStatus = {
            ...record.phaseStatus,
            [event.phase]: 'waiting_user',
          };
        }
        break;
      case 'node.completed':
        record.currentNodeId = event.nodeId ?? record.currentNodeId;

        if (event.nodeId && !record.completedNodes.includes(event.nodeId)) {
          record.completedNodes.push(event.nodeId);
        }

        if (event.phase) {
          const phase = WORKFLOW_PHASES.find((item) => item.id === event.phase);
          const allDone =
            phase?.nodeIds.every((nodeId) => record.completedNodes.includes(nodeId)) ?? false;
          record.phaseStatus = {
            ...record.phaseStatus,
            [event.phase]: allDone ? 'succeeded' : 'running',
          };
        }
        break;
      case 'node.failed':
        record.status = 'failed';

        if (event.phase) {
          record.phaseStatus = {
            ...record.phaseStatus,
            [event.phase]: 'failed',
          };
        }

        if (event.error) {
          record.error = event.error;
        }
        break;
      case 'run.completed':
        record.status = 'succeeded';
        delete record.pendingGate;
        delete record.pendingApproval;
        delete record.error;
        break;
      case 'run.failed':
        record.status = 'failed';

        if (event.error) {
          record.error = event.error;
        }
        delete record.pendingGate;
        delete record.pendingApproval;
        break;
      case 'run.cancelled':
        record.status = 'cancelled';
        delete record.pendingGate;
        delete record.pendingApproval;
        break;
      case 'run.interrupted':
        record.status = 'interrupted';
        delete record.pendingGate;
        delete record.pendingApproval;
        break;
      default:
        break;
    }

    this.persistRecord(record);
    this.records.set(record.projectId, record);
    this.emit('event', event);
  }

  private finish(
    record: WorkflowRunRecord,
    snapshot: Awaited<ReturnType<WorkflowRuntime['start']>>,
  ): void {
    record.status = snapshot.status;

    if (
      snapshot.status === 'succeeded' ||
      snapshot.status === 'cancelled' ||
      snapshot.status === 'interrupted'
    ) {
      record.phaseStatus = snapshot.state.phaseStatus;
    } else if (
      snapshot.status === 'failed' &&
      snapshot.error?.code === 'WORKFLOW_VALIDATION_FAILED'
    ) {
      record.phaseStatus = {
        ...record.phaseStatus,
        video: 'failed',
      };
    }
    // waiting_user / 节点失败：保留事件处理时写入的阶段状态（waiting_user/failed）。

    if (snapshot.status === 'succeeded' || record.currentNodeId === null) {
      record.currentNodeId = snapshot.state.currentNodeId;
    }

    record.completedNodes = [...snapshot.state.completedNodes];
    record.updatedAt = new Date().toISOString();

    if (snapshot.pendingGate) {
      record.pendingGate = snapshot.pendingGate;
    } else {
      delete record.pendingGate;
    }

    if (snapshot.pendingApproval) {
      record.pendingApproval = snapshot.pendingApproval;
    } else {
      delete record.pendingApproval;
    }

    if (snapshot.error) {
      record.error = snapshot.error;
    } else if (snapshot.status !== 'failed') {
      delete record.error;
    }

    this.persistRecord(record);
    this.records.set(record.projectId, record);
  }

  private fail(record: WorkflowRunRecord, error: unknown): void {
    const safe = asRecordError(error);
    record.status = 'failed';
    record.error = safe;
    record.updatedAt = new Date().toISOString();
    this.persistRecord(record);
    this.records.set(record.projectId, record);
    this.emitSynthetic(record, {
      type: 'run.failed',
      status: 'failed',
      error: safe,
    });
  }

  private emitSynthetic(
    record: WorkflowRunRecord,
    input: Omit<RunEvent, 'schemaVersion' | 'runId' | 'projectId' | 'seq' | 'timestamp'>,
  ): void {
    const event = RunEventSchema.parse({
      schemaVersion: '1.0.0',
      runId: record.runId,
      projectId: record.projectId,
      seq: record.lastEventSeq + 1,
      timestamp: new Date().toISOString(),
      ...input,
    });

    this.handleEvent(record, event);
  }

  private requireRecord(projectId: string): WorkflowRunRecord {
    const record = this.records.get(projectId);

    if (!record) {
      throw new IpcError('WORKFLOW_NOT_FOUND', '工作流运行不存在。');
    }

    return record;
  }

  private toPublicState(record: WorkflowRunRecord): WorkflowPublicState {
    let contentRevision = 0;

    try {
      contentRevision = this.options.getProjectStore().get(record.projectId)
        .project.contentRevision;
    } catch {
      // 工程不可读时保留 0；不影响 run 状态展示。
    }

    return {
      runId: record.runId,
      status: record.status,
      phaseStatus: record.phaseStatus,
      currentNodeId: record.currentNodeId,
      ...(record.pendingGate !== undefined ? { pendingGate: record.pendingGate } : {}),
      ...(record.pendingApproval !== undefined ? { pendingApproval: record.pendingApproval } : {}),
      saved: record.status === 'succeeded',
      contentRevision,
      lastEventSeq: record.lastEventSeq,
      ...(record.error !== undefined ? { error: record.error } : {}),
    };
  }

  private projectRunDirectory(record: WorkflowRunRecord): string {
    return path.join(
      this.options.getProjectStore().getProjectDirectory(record.projectId),
      'analysis',
      'runs',
      record.runId,
    );
  }

  private runRecordPath(record: WorkflowRunRecord): string {
    return path.join(this.projectRunDirectory(record), 'run.json');
  }

  private persistRecord(record: WorkflowRunRecord): void {
    const directory = this.projectRunDirectory(record);
    const target = this.runRecordPath(record);
    const temporary = path.join(directory, `.run.json.${randomUUID()}.tmp`);

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      renameSync(temporary, target);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // 清理失败不影响主流程。
      }
    }
  }

  private readLatestRecord(projectId: string): WorkflowRunRecord | undefined {
    const runsDirectory = path.join(
      this.options.getProjectStore().getProjectDirectory(projectId),
      'analysis',
      'runs',
    );

    if (!existsSync(runsDirectory)) {
      return undefined;
    }

    let latest: WorkflowRunRecord | undefined;

    for (const entry of readdirSync(runsDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const record = this.readRecord(projectId, entry.name);

      if (record && (!latest || record.updatedAt > latest.updatedAt)) {
        latest = record;
      }
    }

    return latest;
  }

  private readRecord(projectId: string, runId: string): WorkflowRunRecord | undefined {
    const filePath = path.join(
      this.options.getProjectStore().getProjectDirectory(projectId),
      'analysis',
      'runs',
      runId,
      'run.json',
    );

    if (!existsSync(filePath)) {
      return undefined;
    }

    try {
      const parsed = RunRecordSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private runtimeKey(projectId: string, runId: string): string {
    return `${projectId}:${runId}`;
  }
}
