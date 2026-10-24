import { interrupt, isGraphInterrupt, type GraphInterrupt } from '@langchain/langgraph';
import type { z } from 'zod';
import {
  ApprovalInterruptPayloadSchema,
  getPhaseForNode,
  getPhaseIdForNode,
  type ApprovalInterruptPayload,
  type WorkflowNodeId,
  type WorkflowPhaseStatus,
} from '@miaoma/video-project';
import { WorkflowError, isAbortError, toSafeWorkflowError } from './errors';
import type { NodeContext, WorkflowNodeSpec, WorkflowServices } from './types';
import type { WorkflowGraphState, WorkflowGraphUpdate } from './state';

export interface AttemptCounters {
  get(nodeId: WorkflowNodeId): number;
  next(nodeId: WorkflowNodeId): number;
}

export function createAttemptCounters(): AttemptCounters {
  const counters = new Map<WorkflowNodeId, number>();

  return {
    get: (nodeId) => counters.get(nodeId) ?? 0,
    next: (nodeId) => {
      const next = (counters.get(nodeId) ?? 0) + 1;
      counters.set(nodeId, next);
      return next;
    },
  };
}

function abortError(): Error {
  const error = new Error('workflow aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function zodDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function computePhaseStatus(
  current: WorkflowPhaseStatus,
  nodeId: WorkflowNodeId,
  completedNodes: readonly WorkflowNodeId[],
  status: 'running' | 'succeeded' | 'failed' | 'waiting_user',
): WorkflowPhaseStatus {
  const phaseId = getPhaseIdForNode(nodeId);

  if (!phaseId) {
    return current;
  }

  if (status === 'failed' || status === 'waiting_user') {
    return { ...current, [phaseId]: status };
  }

  const phase = getPhaseForNode(nodeId);
  const allDone = phase?.nodeIds.every((id) => completedNodes.includes(id)) ?? false;

  return {
    ...current,
    [phaseId]: allDone ? 'succeeded' : 'running',
  };
}

function isRegenerateUpdate(nodeId: WorkflowNodeId, update: WorkflowGraphUpdate): boolean {
  if (nodeId === 'creative_brief') {
    return typeof update.briefFeedback === 'string' && update.briefFeedback.length > 0;
  }

  if (nodeId === 'scene_approval') {
    return typeof update.scenePlanFeedback === 'string' && update.scenePlanFeedback.length > 0;
  }

  return false;
}

export function readApprovalInterruptPayload(
  error: GraphInterrupt,
): ApprovalInterruptPayload | undefined {
  for (let position = error.interrupts.length - 1; position >= 0; position -= 1) {
    const value = error.interrupts[position]?.value;
    const parsed = ApprovalInterruptPayloadSchema.safeParse(value);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return undefined;
}

function createNodeContext(services: WorkflowServices, nodeId: WorkflowNodeId): NodeContext {
  return {
    projectId: services.projectId,
    runId: services.runId,
    contentRevision: services.contentRevision,
    projectDirectory: services.projectDirectory,
    artifacts: services.artifacts,
    assets: services.assets,
    projects: services.projects,
    prompts: services.prompts,
    llm: services.llm,
    streams: services.streams,
    signal: services.signal,
    now: services.now,
    newId: services.newId,
    logger: services.logger,
    lastSeq: () => services.events.lastSeq,
    async writeArtifact(options) {
      const result = await services.artifacts.write(options);

      if (result.created) {
        services.events.emit({
          type: 'artifact.written',
          nodeId,
          phase: getPhaseIdForNode(nodeId),
          artifact: result.reference,
        });
      }

      return result.reference;
    },
    readArtifact(reference, schema) {
      return services.artifacts.read(reference, schema);
    },
    findArtifact(kind, cacheKey) {
      return services.artifacts.findReusable(kind, cacheKey);
    },
    emitProgress(progress) {
      services.events.emit({
        type: 'node.progress',
        nodeId,
        phase: getPhaseIdForNode(nodeId),
        progress: {
          current: progress.current,
          total: progress.total,
        },
        ...(progress.detail !== undefined ? { message: progress.detail } : {}),
      });
    },
    interrupt<T>(payload: ApprovalInterruptPayload, responseSchema: z.ZodType<T>): T {
      return interrupt<ApprovalInterruptPayload, T>(payload, { responseSchema });
    },
    throwIfAborted() {
      throwIfAborted(services.signal);
    },
  };
}

/**
 * 所有业务节点共用的高阶包装器：
 * Zod 输入 → execute → Zod 输出 → persist → 事件/日志。
 * `GraphInterrupt` 必须原样抛回 LangGraph，不能在这里被吞掉。
 */
export type WorkflowNodeRunner = (state: WorkflowGraphState) => Promise<WorkflowGraphUpdate>;

export function createNodeRunner<TInput, TOutput>(
  spec: WorkflowNodeSpec<TInput, TOutput>,
  services: WorkflowServices,
  counters: AttemptCounters,
): WorkflowNodeRunner {
  return (state) => runWorkflowNode(spec, state, services, counters);
}

export async function runWorkflowNode<TInput, TOutput>(
  spec: WorkflowNodeSpec<TInput, TOutput>,
  state: WorkflowGraphState,
  services: WorkflowServices,
  counters: AttemptCounters,
): Promise<WorkflowGraphUpdate> {
  const attempt = counters.next(spec.id);
  const startedAt = Date.now();
  const ctx = createNodeContext(services, spec.id);

  services.events.emit({
    type: 'node.started',
    nodeId: spec.id,
    phase: spec.phase,
    status: 'running',
    attempt,
  });
  services.logger.log({
    level: 'info',
    event: 'node.started',
    nodeId: spec.id,
    phase: spec.phase,
    attempt,
  });

  try {
    throwIfAborted(services.signal);

    const rawInput = await spec.loadInput(state, ctx);
    const input = spec.inputSchema.safeParse(rawInput);

    if (!input.success) {
      throw new WorkflowError(
        'WORKFLOW_INPUT_INVALID',
        `${spec.id} 输入不符合 Schema。`,
        false,
        zodDetails(input.error),
      );
    }

    const rawOutput = await spec.execute(input.data, ctx);
    const output = spec.outputSchema.safeParse(rawOutput);

    if (!output.success) {
      throw new WorkflowError(
        'WORKFLOW_OUTPUT_INVALID',
        `${spec.id} 输出不符合 Schema。`,
        false,
        zodDetails(output.error),
      );
    }

    const update = await spec.persist(output.data, ctx);
    const regenerate = isRegenerateUpdate(spec.id, update);
    const completedNodes = regenerate
      ? state.completedNodes
      : unique([...state.completedNodes, spec.id]);
    const phaseStatus = computePhaseStatus(state.phaseStatus, spec.id, completedNodes, 'succeeded');
    const durationMs = Date.now() - startedAt;

    services.events.emit({
      type: 'node.completed',
      nodeId: spec.id,
      phase: spec.phase,
      status: 'succeeded',
      attempt,
      ...(regenerate ? { message: 'regenerate' } : {}),
    });
    services.logger.log({
      level: 'info',
      event: 'node.completed',
      nodeId: spec.id,
      phase: spec.phase,
      attempt,
      durationMs,
    });

    return {
      ...update,
      completedNodes,
      phaseStatus,
      currentNodeId: spec.id,
      status: 'running',
      lastEventSeq: services.events.lastSeq,
    };
  } catch (error) {
    if (isGraphInterrupt(error)) {
      const payload = readApprovalInterruptPayload(error as GraphInterrupt);

      services.events.emit({
        type: 'node.waiting_user',
        nodeId: spec.id,
        phase: spec.phase,
        status: 'waiting_user',
        attempt,
        ...(payload
          ? {
              gate: payload.gate,
              artifact: payload.artifact,
              approval: payload,
              message: payload.title,
            }
          : {}),
      });
      services.logger.log({
        level: 'info',
        event: 'node.waiting_user',
        nodeId: spec.id,
        phase: spec.phase,
        attempt,
        message: payload?.title,
      });
      throw error;
    }

    if (isAbortError(error) || services.signal?.aborted) {
      // run.cancelled 由 WorkflowRuntime 统一发一次，避免重复通知。
      services.logger.log({
        level: 'warn',
        event: 'run.cancelled',
        nodeId: spec.id,
        phase: spec.phase,
        attempt,
      });
      throw error;
    }

    const safe = toSafeWorkflowError(error);

    services.events.emit({
      type: 'node.failed',
      nodeId: spec.id,
      phase: spec.phase,
      status: 'failed',
      attempt,
      error: safe,
    });
    services.logger.log({
      level: 'error',
      event: 'node.failed',
      nodeId: spec.id,
      phase: spec.phase,
      attempt,
      durationMs: Date.now() - startedAt,
      ...(error instanceof Error ? { message: error.message } : {}),
      error: safe,
    });

    throw error;
  }
}
