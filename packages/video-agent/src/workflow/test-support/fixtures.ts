import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ArtifactReference, WorkflowNodeId, WorkflowPhaseId } from '@miaoma/video-project';
import type { LlmProvider } from '../../llm/types';
import { FileArtifactStore } from '../artifacts';
import { createMemoryRunEventSink } from '../events';
import { NullWorkflowLogger } from '../logging';
import type { WorkflowNodeSpec, WorkflowServices } from '../types';
import type { WorkflowGraphUpdate } from '../state';

export const FIXED_NOW = '2026-10-24T00:00:00.000Z';

export async function createTempProject(): Promise<{
  directory: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'magicut-workflow-'));

  return {
    directory,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function fakeArtifact(
  kind: ArtifactReference['kind'] = 'creative_brief',
  ref = 'analysis/brief/fake.json',
): ArtifactReference {
  return {
    kind,
    ref,
    version: 1,
    contentFingerprint: 'a'.repeat(64),
    createdAt: FIXED_NOW,
  };
}

export function createFakeServices(
  directory: string,
  overrides: Partial<WorkflowServices> = {},
): WorkflowServices {
  let idCounter = 0;
  const projectId = overrides.projectId ?? 'project-1';
  const runId = overrides.runId ?? 'run-1';

  return {
    projectId,
    runId,
    contentRevision: 0,
    projectDirectory: directory,
    artifacts: new FileArtifactStore(directory, () => new Date(FIXED_NOW)),
    assets: {
      scanAssets: async () => {
        throw new Error('asset scan not used in this test');
      },
    },
    projects: {
      getDirectory: () => directory,
      read: () => {
        throw new Error('project read not used in this test');
      },
      readCreationInput: () => {
        throw new Error('project creation input not used in this test');
      },
      replaceAssets: () => {
        throw new Error('project replaceAssets not used in this test');
      },
      save: () => {
        throw new Error('project save not used in this test');
      },
    },
    prompts: {
      get: () => ({ system: '', user: '' }),
    },
    llm: createFakeLlmProvider(),
    events: createMemoryRunEventSink({
      projectId,
      runId,
      now: () => new Date(FIXED_NOW),
    }),
    streams: {
      publish: () => undefined,
    },
    logger: new NullWorkflowLogger(),
    now: () => new Date(FIXED_NOW),
    newId: () => `id-${(idCounter += 1)}`,
    ...overrides,
  };
}

export function createFakeLlmProvider(): LlmProvider {
  return {
    id: 'fake',
    defaultModel: 'fake-model',
    getCapabilities: () => ({
      provider: 'fake',
      model: 'fake-model',
      streaming: false,
      reasoning: false,
    }),
    generate: async () => {
      throw new Error('llm not used in this test');
    },
    stream: async function* () {
      yield* [];
      throw new Error('llm not used in this test');
    },
  };
}

export function noopNodeSpec(
  id: WorkflowNodeId,
  phase: WorkflowPhaseId,
  persist: () => Promise<WorkflowGraphUpdate>,
): WorkflowNodeSpec<Record<string, never>, { ok: true }> {
  return {
    id,
    phase,
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({ ok: z.literal(true) }),
    loadInput: async () => ({}),
    execute: async () => ({ ok: true }),
    persist: async () => persist(),
  };
}
