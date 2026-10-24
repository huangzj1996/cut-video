import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PromptProvider } from '@miaoma/video-agent/workflow';
import { ProjectStore } from '../projects/project-store';
import { WorkflowRunManager } from './run-manager';

const NOW = '2026-10-24T00:00:00.000Z';

const prompts: PromptProvider = {
  get: () => ({ system: '', user: '' }),
};

describe('WorkflowRunManager recovery', () => {
  let root: string;
  let store: ProjectStore;
  let projectId: string;
  let manager: WorkflowRunManager;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'miaoma-run-manager-'));
    store = new ProjectStore(root);
    projectId = store.create({ name: '测试项目' }).project.projectId;
    manager = new WorkflowRunManager({
      getProjectStore: () => store,
      getLlmProvider: () => {
        throw new Error('llm should not be created during recovery');
      },
      prompts,
      media: {
        isPackaged: false,
        appPath: '',
        resourcesPath: '',
      },
    });
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  function writeRun(runId: string, status: string): string {
    const directory = path.join(root, projectId, 'analysis', 'runs', runId);
    mkdirSync(directory, { recursive: true });
    const record = {
      schemaVersion: '1.0.0',
      runId,
      projectId,
      threadId: `${projectId}:${runId}`,
      status,
      startedAt: NOW,
      updatedAt: NOW,
      lastEventSeq: 4,
      currentNodeId: 'creative_brief',
      completedNodes: ['scan_assets', 'analyze_assets'],
      phaseStatus: {
        prepare: 'running',
        storyboard: 'pending',
        voice: 'pending',
        video: 'pending',
      },
    };
    writeFileSync(path.join(directory, 'run.json'), JSON.stringify(record), 'utf8');
    return path.join(directory, 'run.json');
  }

  it('marks running runs as interrupted without starting a model call', () => {
    const filePath = writeRun('run-1', 'running');

    manager.recover();

    expect(manager.getState(projectId)?.status).toBe('interrupted');
    const record = JSON.parse(readFileSync(filePath, 'utf8')) as { status: string };
    expect(record.status).toBe('interrupted');
  });

  it('keeps waiting_user runs resumable after restart', () => {
    writeRun('run-1', 'waiting_user');

    manager.recover();

    expect(manager.getState(projectId)?.status).toBe('waiting_user');
    expect(manager.getRecord(projectId)?.runId).toBe('run-1');
  });
});
