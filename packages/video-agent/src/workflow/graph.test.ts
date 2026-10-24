import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApprovalDecisionSchema,
  type ApprovalGate,
  type ApprovalInterruptPayload,
  type RunEvent,
} from '@miaoma/video-project';
import { JsonFileCheckpointer } from './checkpointer';
import { createMemoryRunEventSink } from './events';
import type { WorkflowNodeRunners } from './graph';
import { createAttemptCounters, createNodeRunner } from './node-wrapper';
import { WorkflowRuntime } from './runtime';
import { createInitialWorkflowState, type WorkflowGraphState } from './state';
import {
  createFakeServices,
  createTempProject,
  fakeArtifact,
  noopNodeSpec,
} from './test-support/fixtures';
import type { WorkflowNodeSpec, WorkflowServices } from './types';

const PROJECT_ID = 'project-1';
const RUN_ID = 'run-1';
const THREAD_ID = `${PROJECT_ID}:${RUN_ID}`;

function approvalPayload(gate: ApprovalGate): ApprovalInterruptPayload {
  return {
    gate,
    artifact: fakeArtifact(
      gate === 'A3' ? 'scene_plan' : 'creative_brief',
      gate === 'A3'
        ? 'analysis/scenes/scene-plan.v1.json'
        : 'analysis/brief/creative-brief.v1.json',
    ),
    title: `${gate} 待确认`,
    summary: '测试审批',
    prompt: '回复「确认」继续，或直接说明要修改的内容',
  };
}

interface Harness {
  directory: string;
  services: WorkflowServices;
  events: RunEvent[];
  runtime: WorkflowRuntime;
  initialState: WorkflowGraphState;
  makeRuntime: () => WorkflowRuntime;
  cleanup: () => Promise<void>;
}

async function buildHarness(options: { validationPassed?: boolean } = {}): Promise<Harness> {
  const temp = await createTempProject();
  const events: RunEvent[] = [];
  const services = createFakeServices(temp.directory, {
    events: createMemoryRunEventSink({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      now: () => new Date('2026-10-24T00:00:00.000Z'),
      onEvent: (event) => events.push(event),
    }),
  });
  const counters = createAttemptCounters();

  const creativeBriefSpec: WorkflowNodeSpec<
    Record<string, never>,
    { kind: 'approved' } | { kind: 'regenerate'; feedback: string }
  > = {
    id: 'creative_brief',
    phase: 'prepare',
    inputSchema: z.strictObject({}),
    outputSchema: z.union([
      z.strictObject({ kind: z.literal('approved') }),
      z.strictObject({ kind: z.literal('regenerate'), feedback: z.string().min(1) }),
    ]),
    loadInput: async () => ({}),
    execute: async (_input, ctx) => {
      const a1 = ctx.interrupt(approvalPayload('A1'), ApprovalDecisionSchema);

      if (a1.decision === 'request_changes') {
        return { kind: 'regenerate', feedback: a1.feedback };
      }

      const a2 = ctx.interrupt(approvalPayload('A2'), ApprovalDecisionSchema);

      if (a2.decision === 'request_changes') {
        return { kind: 'regenerate', feedback: a2.feedback };
      }

      return { kind: 'approved' };
    },
    persist: async (output) =>
      output.kind === 'regenerate' ? { briefFeedback: output.feedback } : { briefFeedback: null },
  };

  const sceneApprovalSpec: WorkflowNodeSpec<
    Record<string, never>,
    { kind: 'approved' } | { kind: 'regenerate'; feedback: string }
  > = {
    id: 'scene_approval',
    phase: 'storyboard',
    inputSchema: z.strictObject({}),
    outputSchema: z.union([
      z.strictObject({ kind: z.literal('approved') }),
      z.strictObject({ kind: z.literal('regenerate'), feedback: z.string().min(1) }),
    ]),
    loadInput: async () => ({}),
    execute: async (_input, ctx) => {
      const a3 = ctx.interrupt(approvalPayload('A3'), ApprovalDecisionSchema);

      if (a3.decision === 'request_changes') {
        return { kind: 'regenerate', feedback: a3.feedback };
      }

      return { kind: 'approved' };
    },
    persist: async (output) =>
      output.kind === 'regenerate'
        ? { scenePlanFeedback: output.feedback }
        : { scenePlanFeedback: null },
  };

  const runners: WorkflowNodeRunners = {
    scan_assets: createNodeRunner(
      noopNodeSpec('scan_assets', 'prepare', async () => ({})),
      services,
      counters,
    ),
    analyze_assets: createNodeRunner(
      noopNodeSpec('analyze_assets', 'prepare', async () => ({})),
      services,
      counters,
    ),
    creative_brief: createNodeRunner(creativeBriefSpec, services, counters),
    plan_scenes: createNodeRunner(
      noopNodeSpec('plan_scenes', 'storyboard', async () => ({})),
      services,
      counters,
    ),
    scene_approval: createNodeRunner(sceneApprovalSpec, services, counters),
    synthesize_voice: createNodeRunner(
      noopNodeSpec('synthesize_voice', 'voice', async () => ({})),
      services,
      counters,
    ),
    match_assets: createNodeRunner(
      noopNodeSpec('match_assets', 'video', async () => ({})),
      services,
      counters,
    ),
    assemble_timeline: createNodeRunner(
      noopNodeSpec('assemble_timeline', 'video', async () => ({})),
      services,
      counters,
    ),
    validate_project: createNodeRunner(
      noopNodeSpec('validate_project', 'video', async () => ({
        validationPassed: options.validationPassed ?? true,
      })),
      services,
      counters,
    ),
    save_project: createNodeRunner(
      noopNodeSpec('save_project', 'video', async () => ({
        savedProjectRef: fakeArtifact('saved_project_ref', 'analysis/saved/saved-project.v1.json'),
      })),
      services,
      counters,
    ),
  };

  const makeRuntime = () => {
    const checkpointer = new JsonFileCheckpointer({
      directory: path.join(temp.directory, 'checkpoints'),
      threadId: THREAD_ID,
    });

    return new WorkflowRuntime({
      services,
      runners,
      checkpointer,
      recursionLimit: 50,
    });
  };

  const initialState = createInitialWorkflowState({
    projectId: PROJECT_ID,
    runId: RUN_ID,
    contentRevision: 0,
    creationInputRef: null,
  });

  return {
    directory: temp.directory,
    services,
    events,
    runtime: makeRuntime(),
    initialState,
    makeRuntime,
    cleanup: temp.cleanup,
  };
}

describe('workflow graph', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('pauses at A1, then A2, then A3 and completes', async () => {
    let snapshot = await harness.runtime.start(harness.initialState);

    expect(snapshot.status).toBe('waiting_user');
    expect(snapshot.pendingGate).toBe('A1');
    expect(
      harness.events.some((event) => event.type === 'node.waiting_user' && event.gate === 'A1'),
    ).toBe(true);

    snapshot = await harness.runtime.resume({ decision: 'approve' });
    expect(snapshot.pendingGate).toBe('A2');

    snapshot = await harness.runtime.resume({ decision: 'approve' });
    expect(snapshot.pendingGate).toBe('A3');

    snapshot = await harness.runtime.resume({ decision: 'approve' });
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.state.refs.savedProjectRef).not.toBeNull();
    expect(harness.events.some((event) => event.type === 'run.completed')).toBe(true);
  });

  it('exposes the pending gate through getState', async () => {
    await harness.runtime.start(harness.initialState);

    const state = await harness.runtime.getState();

    expect(state.status).toBe('waiting_user');
    expect(state.pendingGate).toBe('A1');
    expect(state.pendingApproval?.gate).toBe('A1');
  });

  it('routes A1 request_changes back to creative_brief with feedback', async () => {
    await harness.runtime.start(harness.initialState);

    const snapshot = await harness.runtime.resume({
      decision: 'request_changes',
      feedback: '把时长缩短到 45 秒',
    });

    expect(snapshot.status).toBe('waiting_user');
    expect(snapshot.pendingGate).toBe('A1');
    expect(snapshot.state.briefFeedback).toBe('把时长缩短到 45 秒');
  });

  it('resumes from a fresh runtime instance after a restart', async () => {
    await harness.runtime.start(harness.initialState);

    const restarted = harness.makeRuntime();
    const snapshot = await restarted.resume({ decision: 'approve' });

    expect(snapshot.status).toBe('waiting_user');
    expect(snapshot.pendingGate).toBe('A2');
  });

  it('keeps waiting when the resume value is invalid', async () => {
    await harness.runtime.start(harness.initialState);

    const snapshot = await harness.runtime.resume({
      decision: 'request_changes',
      feedback: '',
    } as never);

    expect(snapshot.status).toBe('waiting_user');
    expect(snapshot.pendingGate).toBe('A1');
    expect(snapshot.error?.code).toBe('WORKFLOW_INPUT_INVALID');
  });
});

describe('workflow graph validation failure', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness({ validationPassed: false });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('ends failed without saving when validation fails', async () => {
    await harness.runtime.start(harness.initialState);
    await harness.runtime.resume({ decision: 'approve' });
    await harness.runtime.resume({ decision: 'approve' });
    const snapshot = await harness.runtime.resume({ decision: 'approve' });

    expect(snapshot.status).toBe('failed');
    expect(snapshot.error?.code).toBe('WORKFLOW_VALIDATION_FAILED');
    expect(snapshot.state.refs.savedProjectRef).toBeNull();
    expect(harness.events.some((event) => event.type === 'run.failed')).toBe(true);
  });
});
