import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RunEvent } from '@miaoma/video-project';
import { createMemoryRunEventSink } from './events';
import { redactLogText } from './logging';
import { createAttemptCounters, runWorkflowNode } from './node-wrapper';
import { createInitialWorkflowState } from './state';
import { createFakeServices, createTempProject } from './test-support/fixtures';
import type { WorkflowNodeSpec, WorkflowServices } from './types';

const baseState = createInitialWorkflowState({
  projectId: 'project-1',
  runId: 'run-1',
  contentRevision: 0,
  creationInputRef: null,
});

describe('workflow node wrapper', () => {
  let directory: string;
  let cleanup: () => Promise<void>;
  let events: RunEvent[];
  let services: WorkflowServices;

  beforeEach(async () => {
    const temp = await createTempProject();
    directory = temp.directory;
    cleanup = temp.cleanup;
    events = [];
    services = createFakeServices(directory, {
      events: createMemoryRunEventSink({
        projectId: 'project-1',
        runId: 'run-1',
        now: () => new Date('2026-10-24T00:00:00.000Z'),
        onEvent: (event) => events.push(event),
      }),
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('validates input/output and emits lifecycle events', async () => {
    const spec: WorkflowNodeSpec<{ value: number }, { value: number }> = {
      id: 'scan_assets',
      phase: 'prepare',
      inputSchema: z.strictObject({ value: z.number() }),
      outputSchema: z.strictObject({ value: z.number() }),
      loadInput: async () => ({ value: 1 }),
      execute: async (input) => ({ value: input.value + 1 }),
      persist: async () => ({}),
    };

    const update = await runWorkflowNode(spec, baseState, services, createAttemptCounters());

    expect(update.completedNodes).toEqual(['scan_assets']);
    expect(update.phaseStatus?.prepare).toBe('running');
    expect(events.map((event) => event.type)).toEqual(['node.started', 'node.completed']);
  });

  it('reports invalid input as a failed node', async () => {
    const spec: WorkflowNodeSpec<{ value: number }, { ok: true }> = {
      id: 'scan_assets',
      phase: 'prepare',
      inputSchema: z.strictObject({ value: z.number() }),
      outputSchema: z.strictObject({ ok: z.literal(true) }),
      loadInput: async () => ({ value: 'not-a-number' }) as never,
      execute: async () => ({ ok: true }),
      persist: async () => ({}),
    };

    await expect(
      runWorkflowNode(spec, baseState, services, createAttemptCounters()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INPUT_INVALID' });

    expect(events.map((event) => event.type)).toEqual(['node.started', 'node.failed']);
  });

  it('reports invalid output as a failed node', async () => {
    const spec: WorkflowNodeSpec<Record<string, never>, { ok: true }> = {
      id: 'scan_assets',
      phase: 'prepare',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({ ok: z.literal(true) }),
      loadInput: async () => ({}),
      execute: async () => ({ ok: false }) as never,
      persist: async () => ({}),
    };

    await expect(
      runWorkflowNode(spec, baseState, services, createAttemptCounters()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_OUTPUT_INVALID' });

    expect(events.map((event) => event.type)).toEqual(['node.started', 'node.failed']);
  });

  it('reuses an existing artifact without duplicate writes or events', async () => {
    const dataSchema = z.strictObject({ value: z.number() });

    const spec: WorkflowNodeSpec<Record<string, never>, { ok: true }> = {
      id: 'scan_assets',
      phase: 'prepare',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({ ok: z.literal(true) }),
      loadInput: async () => ({}),
      execute: async (_input, ctx) => {
        const first = await ctx.writeArtifact({
          kind: 'creative_brief',
          data: { value: 1 },
          schema: dataSchema,
          fileName: 'analysis/brief/test.v1.json',
          version: 1,
          cacheKey: 'fingerprint-1',
        });
        const second = await ctx.writeArtifact({
          kind: 'creative_brief',
          data: { value: 1 },
          schema: dataSchema,
          fileName: 'analysis/brief/test.v1.json',
          version: 1,
          cacheKey: 'fingerprint-1',
        });

        expect(second).toEqual(first);
        return { ok: true };
      },
      persist: async () => ({}),
    };

    await runWorkflowNode(spec, baseState, services, createAttemptCounters());

    expect(events.filter((event) => event.type === 'artifact.written')).toHaveLength(1);
    await expect(
      services.artifacts.findReusable('creative_brief', 'fingerprint-1'),
    ).resolves.not.toBeNull();
  });

  it('redacts secrets from log text', () => {
    expect(redactLogText('api_key=sk-secret token: abc')).toBe(
      'api_key=[redacted] token=[redacted]',
    );
  });
});
