import {
  Command,
  isGraphInterrupt,
  type GraphInterrupt,
  type StateSnapshot,
} from '@langchain/langgraph';
import {
  ApprovalInterruptPayloadSchema,
  type ApprovalDecision,
  type ApprovalInterruptPayload,
  type WorkflowNodeId,
  type WorkflowState,
} from '@miaoma/video-project';
import {
  WorkflowError,
  isAbortError,
  isRecursionLimitError,
  toSafeWorkflowError,
  type SafeWorkflowError,
} from './errors';
import { createWorkflowGraph, type WorkflowNodeRunners } from './graph';
import { readApprovalInterruptPayload } from './node-wrapper';
import { toWorkflowState, type WorkflowGraphState, type WorkflowGraphUpdate } from './state';
import type { WorkflowRunSnapshot, WorkflowServices } from './types';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

export interface WorkflowRuntimeOptions {
  services: WorkflowServices;
  runners: WorkflowNodeRunners;
  checkpointer: BaseCheckpointSaver;
  recursionLimit?: number;
  /** RunManager 统一持有的取消信号；未提供时 runtime 自建。 */
  signal?: AbortSignal;
}

const DEFAULT_RECURSION_LIMIT = 50;

function isInterruptError(error: unknown): error is GraphInterrupt {
  return isGraphInterrupt(error);
}

function readPayloadFromSnapshot(snapshot: StateSnapshot): ApprovalInterruptPayload | undefined {
  for (const task of snapshot.tasks) {
    for (const interrupt of task.interrupts ?? []) {
      const parsed = ApprovalInterruptPayloadSchema.safeParse(interrupt.value);

      if (parsed.success) {
        return parsed.data;
      }
    }
  }

  return undefined;
}

function isGraphState(value: unknown): value is WorkflowGraphState {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { projectId?: unknown }).projectId === 'string' &&
    typeof (value as { runId?: unknown }).runId === 'string'
  );
}

/**
 * 单次 run 的 LangGraph 运行时。
 *
 * - `start` 从初始 state 运行，遇到 interrupt 返回 waiting_user；
 * - `resume` 用 `Command({resume})` 或 `invoke(null)` 继续；
 * - `getState` 从 checkpoint 读取最新状态和 pending gate；
 * - `cancel` 通过 AbortSignal 终止当前 invoke。
 *
 * 运行记录（run.json）、消息和事件广播由桌面 RunManager 负责。
 */
export class WorkflowRuntime {
  private readonly graph;
  private readonly controller: AbortController | null;
  private readonly threadId: string;
  private readonly recursionLimit: number;
  private fallbackState: WorkflowGraphState | null = null;

  constructor(private readonly options: WorkflowRuntimeOptions) {
    this.threadId = `${options.services.projectId}:${options.services.runId}`;
    this.recursionLimit = options.recursionLimit ?? DEFAULT_RECURSION_LIMIT;
    this.controller = options.signal ? null : new AbortController();
    this.graph = createWorkflowGraph({
      checkpointer: options.checkpointer,
      runners: options.runners,
    });
  }

  get signal(): AbortSignal {
    return this.options.signal ?? this.controller!.signal;
  }

  async start(input: WorkflowGraphState): Promise<WorkflowRunSnapshot> {
    this.fallbackState = input;
    this.options.services.events.emit({
      type: 'run.started',
      status: 'running',
    });
    return this.run(input);
  }

  async resume(decision?: ApprovalDecision): Promise<WorkflowRunSnapshot> {
    const input = decision
      ? new Command<unknown, WorkflowGraphUpdate, WorkflowNodeId>({
          resume: decision,
        })
      : null;
    this.options.services.events.emit({
      type: 'run.resumed',
      status: 'running',
    });
    return this.run(input);
  }

  async getState(): Promise<WorkflowRunSnapshot> {
    const snapshot = await this.graph.getState(this.config());
    const values = snapshot.values;

    if (!isGraphState(values)) {
      throw new WorkflowError('WORKFLOW_NOT_FOUND', '工作流运行不存在。');
    }

    this.fallbackState = values;
    const pendingApproval = readPayloadFromSnapshot(snapshot);
    const status = pendingApproval
      ? 'waiting_user'
      : snapshot.next.length > 0
        ? 'running'
        : values.savedProjectRef !== null
          ? 'succeeded'
          : 'failed';

    return this.snapshot(values, status, {
      ...(pendingApproval
        ? {
            pendingGate: pendingApproval.gate,
            pendingApproval,
          }
        : {}),
    });
  }

  cancel(): void {
    this.controller?.abort();
  }

  private async run(
    input: WorkflowGraphState | Command<unknown, WorkflowGraphUpdate, WorkflowNodeId> | null,
  ): Promise<WorkflowRunSnapshot> {
    const services = this.options.services;

    try {
      const result = await this.graph.invoke(input, {
        configurable: { thread_id: this.threadId },
        recursionLimit: this.recursionLimit,
        signal: this.signal,
      });

      if (!isGraphState(result)) {
        throw new WorkflowError('WORKFLOW_STEP_FAILED', '工作流返回了无效状态。');
      }

      this.fallbackState = result;

      // LangGraph 会把 interrupt 作为正常返回值交回；必须从 checkpoint
      // 的 pending tasks 读取，不能只看返回值。
      const pending = await this.readPendingInterrupt();

      if (pending) {
        return this.snapshot(pending.state, 'waiting_user', {
          pendingGate: pending.payload.gate,
          pendingApproval: pending.payload,
        });
      }

      if (result.savedProjectRef !== null) {
        services.events.emit({
          type: 'run.completed',
          status: 'succeeded',
          message: '工程已保存。',
        });
        return this.snapshot(result, 'succeeded');
      }

      const error: SafeWorkflowError = {
        code: 'WORKFLOW_VALIDATION_FAILED',
        message: '工程校验未通过，未保存工程。',
        retryable: false,
      };

      services.events.emit({
        type: 'run.failed',
        status: 'failed',
        error,
        ...(result.validationRef ? { artifact: result.validationRef } : {}),
      });
      return this.snapshot(result, 'failed', { error });
    } catch (error) {
      if (isInterruptError(error)) {
        const pending = await this.readPendingInterrupt();
        const pendingApproval = pending?.payload ?? readApprovalInterruptPayload(error);
        const state = pending?.state ?? (await this.readFallbackState());

        return this.snapshot(state, 'waiting_user', {
          ...(pendingApproval
            ? {
                pendingGate: pendingApproval.gate,
                pendingApproval,
              }
            : {}),
        });
      }

      if (isAbortError(error) || this.signal.aborted) {
        services.events.emit({ type: 'run.cancelled', status: 'cancelled' });
        const state = await this.readFallbackState();
        return this.snapshot(state, 'cancelled');
      }

      // resume 值未通过 responseSchema 校验时，LangGraph 仍停在原 interrupt。
      // 此时不能把 run 标为 failed，否则用户无法修正输入。
      const waiting = await this.tryReadWaitingState();

      if (waiting) {
        return this.snapshot(waiting.state, 'waiting_user', {
          pendingGate: waiting.pendingGate,
          pendingApproval: waiting.pendingApproval,
          error: {
            code: 'WORKFLOW_INPUT_INVALID',
            message: '审批回复格式无效，请重新输入。',
            retryable: true,
          },
        });
      }

      const safe: SafeWorkflowError = isRecursionLimitError(error)
        ? {
            code: 'WORKFLOW_RECURSION_LIMIT',
            message: '工作流步数超过上限，请减少修改轮次后重试。',
            retryable: false,
          }
        : toSafeWorkflowError(error);

      services.events.emit({
        type: 'run.failed',
        status: 'failed',
        error: safe,
      });
      const state = await this.readFallbackState();
      return this.snapshot(state, 'failed', { error: safe });
    }
  }

  private async readPendingInterrupt(): Promise<
    | {
        state: WorkflowGraphState;
        payload: ApprovalInterruptPayload;
      }
    | undefined
  > {
    try {
      const snapshot = await this.graph.getState(this.config());

      if (!isGraphState(snapshot.values)) {
        return undefined;
      }

      const payload = readPayloadFromSnapshot(snapshot);

      if (!payload) {
        return undefined;
      }

      this.fallbackState = snapshot.values;
      return { state: snapshot.values, payload };
    } catch {
      return undefined;
    }
  }

  private async tryReadWaitingState(): Promise<
    | {
        state: WorkflowGraphState;
        pendingGate: ApprovalInterruptPayload['gate'];
        pendingApproval: ApprovalInterruptPayload;
      }
    | undefined
  > {
    const pending = await this.readPendingInterrupt();

    if (!pending) {
      return undefined;
    }

    return {
      state: pending.state,
      pendingGate: pending.payload.gate,
      pendingApproval: pending.payload,
    };
  }

  private async readFallbackState(): Promise<WorkflowGraphState> {
    try {
      const snapshot = await this.graph.getState(this.config());

      if (isGraphState(snapshot.values)) {
        this.fallbackState = snapshot.values;
        return snapshot.values;
      }
    } catch {
      // 使用最近一次已知状态。
    }

    if (this.fallbackState) {
      return this.fallbackState;
    }

    throw new WorkflowError('WORKFLOW_NOT_FOUND', '工作流运行不存在。');
  }

  private snapshot(
    state: WorkflowGraphState,
    status: WorkflowState['status'],
    extras: Partial<Pick<WorkflowRunSnapshot, 'pendingGate' | 'pendingApproval' | 'error'>> = {},
  ): WorkflowRunSnapshot {
    return {
      runId: this.options.services.runId,
      status,
      state: toWorkflowState(state, { status }),
      ...extras,
    };
  }

  private config(): { configurable: { thread_id: string } } {
    return {
      configurable: {
        thread_id: this.threadId,
      },
    };
  }
}
