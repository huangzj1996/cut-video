import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LlmProvider } from '@miaoma/video-agent/llm';
import {
  FileArtifactStore,
  JsonFileCheckpointer,
  JsonlWorkflowLogger,
  WorkflowRuntime,
  createMemoryRunEventSink,
  createWorkflowRunners,
  type DefaultRunEventSink,
  type PromptProvider,
  type WorkflowNodeRunners,
  type WorkflowServices,
} from '@miaoma/video-agent/workflow';
import type { ChatStreamEvent, RunEvent } from '@miaoma/video-project';
import type { ProjectStore } from '../projects/project-store';
import { createDesktopProjectPort } from './project-port';
import { createDesktopScanPort } from './scan-port';

export interface WorkflowCompositionOptions {
  projectId: string;
  runId: string;
  contentRevision: number;
  projectStore: ProjectStore;
  llmProvider: LlmProvider;
  prompts: PromptProvider;
  signal: AbortSignal;
  initialEventSeq?: number;
  onEvent: (event: RunEvent) => void;
  onStream?: (event: ChatStreamEvent) => void;
  media: {
    isPackaged: boolean;
    appPath: string;
    resourcesPath: string;
  };
}

export interface WorkflowComposition {
  runtime: WorkflowRuntime;
  services: WorkflowServices;
  runners: WorkflowNodeRunners;
  events: DefaultRunEventSink;
  logger: JsonlWorkflowLogger;
  projectDirectory: string;
  runDirectory: string;
}

export function createWorkflowComposition(
  options: WorkflowCompositionOptions,
): WorkflowComposition {
  const projectDirectory = options.projectStore.getProjectDirectory(options.projectId);
  const runDirectory = path.join(projectDirectory, 'analysis', 'runs', options.runId);
  const artifacts = new FileArtifactStore(projectDirectory);
  // RunManager 在同一回调里同步追加 events.jsonl、更新 run.json，再广播，
  // 保证“先持久化后推送”的顺序。这里只负责生成事件和 seq。
  const events = createMemoryRunEventSink({
    projectId: options.projectId,
    runId: options.runId,
    ...(options.initialEventSeq !== undefined ? { initialSeq: options.initialEventSeq } : {}),
    onEvent: options.onEvent,
  });
  const logger = new JsonlWorkflowLogger(path.join(runDirectory, 'workflow.log.jsonl'));
  const streams = {
    publish(chunk: {
      attempt: number;
      done: boolean;
      draft: ChatStreamEvent['draft'];
      streamId: string;
    }): void {
      options.onStream?.({
        schemaVersion: '1.0.0',
        projectId: options.projectId,
        runId: options.runId,
        nodeId: 'creative_brief',
        timestamp: new Date().toISOString(),
        ...chunk,
      });
    },
  };
  const projects = createDesktopProjectPort(() => options.projectStore);
  const assets = createDesktopScanPort({
    getProjectStore: () => options.projectStore,
    isPackaged: options.media.isPackaged,
    appPath: options.media.appPath,
    resourcesPath: options.media.resourcesPath,
  });
  const services: WorkflowServices = {
    projectId: options.projectId,
    runId: options.runId,
    contentRevision: options.contentRevision,
    projectDirectory,
    artifacts,
    assets,
    projects,
    prompts: options.prompts,
    llm: options.llmProvider,
    events,
    streams,
    logger,
    signal: options.signal,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
  const runners = createWorkflowRunners(services);
  const checkpointer = new JsonFileCheckpointer({
    directory: path.join(runDirectory, 'checkpoints'),
    threadId: `${options.projectId}:${options.runId}`,
  });
  const runtime = new WorkflowRuntime({
    services,
    runners,
    checkpointer,
    recursionLimit: 50,
    signal: options.signal,
  });

  return {
    runtime,
    services,
    runners,
    events,
    logger,
    projectDirectory,
    runDirectory,
  };
}
