import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreativeBriefSchema,
  ProductionSpecSchema,
  RunEventSchema,
  VideoProjectSchema,
  type ApprovalInterruptPayload,
  type ArtifactReference,
  type RunEvent,
} from '@miaoma/video-project';
import { FileArtifactStore, buildProductionSpec } from '@miaoma/video-agent/workflow';
import { ProjectStore } from '../projects/project-store';
import { ChatMessageMapper } from './message-mapper';

const NOW = '2026-10-24T00:00:00.000Z';
const RUN_ID = 'run-1';

function briefContent() {
  return {
    audience: {
      description: '测试受众',
      needs: ['理解核心信息'],
      primary: '测试用户',
    },
    contentType: 'knowledge' as const,
    coreMessage: { statement: '核心信息', supportingPoints: ['要点一'] },
    coverageIssues: [],
    durationSeconds: 30,
    narrativeStructure: {
      type: 'hook_explain_cta' as const,
      beats: [
        { estimatedSeconds: 15, label: '开场', purpose: '开场', summary: '开场' },
        { estimatedSeconds: 15, label: '解释', purpose: '解释', summary: '解释' },
      ],
    },
    openQuestions: [],
    style: { pacing: 'medium' as const, toneKeywords: ['清晰'], visualTone: '明亮自然' },
    summary: '测试简报',
    title: '测试视频',
    topic: '测试主题',
  };
}

describe('ChatMessageMapper', () => {
  let root: string;
  let projectStore: ProjectStore;
  let projectId: string;
  let mapper: ChatMessageMapper;
  let artifact: ArtifactReference;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'miaoma-message-mapper-'));
    projectStore = new ProjectStore(root);
    projectId = projectStore.create({ name: '测试项目' }).project.projectId;
    mapper = new ChatMessageMapper({ projectId, projectStore });
    const store = new FileArtifactStore(path.join(root, projectId));
    const written = await store.write({
      kind: 'creative_brief',
      data: CreativeBriefSchema.parse({
        ...briefContent(),
        briefVersion: 1,
        generatedAt: NOW,
        inputFingerprint: 'fingerprint',
        schemaVersion: '1.0.0',
      }),
      schema: CreativeBriefSchema,
      fileName: 'analysis/brief/creative-brief.v1.json',
      version: 1,
      cacheKey: 'fingerprint',
    });
    artifact = written.reference;
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  function event(
    seq: number,
    input: Omit<RunEvent, 'schemaVersion' | 'runId' | 'projectId' | 'seq' | 'timestamp'>,
  ): RunEvent {
    return RunEventSchema.parse({
      schemaVersion: '1.0.0',
      runId: RUN_ID,
      projectId,
      seq,
      timestamp: NOW,
      ...input,
    });
  }

  it('maps node lifecycle to execution updates', async () => {
    const messages = await mapper.mapEvent(
      event(1, {
        type: 'node.started',
        phase: 'prepare',
        nodeId: 'scan_assets',
        status: 'running',
        attempt: 1,
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'execution_update',
      role: 'assistant',
      payload: {
        phase: 'prepare',
        nodeId: 'scan_assets',
        status: 'running',
        attempt: 1,
      },
    });
  });

  it('maps waiting_user to an execution update and approval request', async () => {
    const approval: ApprovalInterruptPayload = {
      gate: 'A3',
      artifact,
      title: '分镜待确认',
      summary: '共 2 个分镜',
      prompt: '回复「确认」继续，或直接说明要修改的内容',
    };
    const messages = await mapper.mapEvent(
      event(2, {
        type: 'node.waiting_user',
        phase: 'storyboard',
        nodeId: 'scene_approval',
        status: 'waiting_user',
        attempt: 1,
        approval,
        gate: 'A3',
        artifact,
      }),
    );

    expect(messages.map((message) => message.type)).toEqual([
      'execution_update',
      'approval_request',
    ]);
    expect(messages[1]?.payload).toEqual(approval);
  });

  it('maps artifact.written to a script analysis card', async () => {
    const messages = await mapper.mapEvent(
      event(3, {
        type: 'artifact.written',
        phase: 'prepare',
        nodeId: 'creative_brief',
        artifact,
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'script_analysis',
      payload: {
        briefVersion: 1,
        brief: { title: '测试视频' },
        artifact,
      },
    });
  });

  it('maps run.completed to a video overview from the latest artifacts', async () => {
    const store = new FileArtifactStore(path.join(root, projectId));
    const spec = buildProductionSpec({
      brief: briefContent(),
      voicePresetId: 'wenrou-xuejie',
      specVersion: 1,
    });
    const specWritten = await store.write({
      kind: 'production_spec',
      data: spec,
      schema: ProductionSpecSchema,
      fileName: 'analysis/spec/production-spec.v1.json',
      version: 1,
      cacheKey: spec.contentFingerprint,
    });
    const project = VideoProjectSchema.parse({
      ai: {
        inputFingerprint: 'project-fingerprint',
        model: 'deepseek-chat',
        modelConfigVersion: 'v1',
        provider: 'deepseek',
        runId: RUN_ID,
        startedAt: NOW,
      },
      assets: { music: [], subtitles: [], thumbnails: [], videos: [], voices: [] },
      canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
      project: {
        contentRevision: 1,
        createdAt: NOW,
        name: '测试项目',
        projectId,
        updatedAt: NOW,
      },
      render: {
        audioBitrateKbps: 192,
        audioCodec: 'aac',
        burnSubtitles: true,
        container: 'mp4',
        sourceAudioMuted: true,
        videoCodec: 'h264',
      },
      scenes: [
        {
          id: 'scene-01',
          index: 1,
          title: '开场',
          script: '测试旁白。',
          visualIntent: '测试画面',
          goal: '验证',
          notes: '',
          durationMs: 5_000,
          matchedVideoAssetIds: [],
          subtitleIds: [],
          voiceAssetId: 'voice-scene-01',
        },
      ],
      schemaVersion: '1.0.0',
      tracks: [],
    });
    const projectWritten = await store.write({
      kind: 'video_project',
      data: project,
      schema: VideoProjectSchema,
      fileName: 'analysis/timeline/video-project.v1.json',
      version: 1,
      cacheKey: project.ai.inputFingerprint,
    });

    const messages = await mapper.mapEvent(
      event(5, {
        type: 'run.completed',
        status: 'succeeded',
        artifact: projectWritten.reference,
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'video_overview',
      payload: {
        title: '测试项目',
        durationSeconds: 5,
        projectRevision: 1,
        spec: specWritten.reference,
        project: projectWritten.reference,
      },
    });
  });

  it('maps run failures to error cards', async () => {
    const messages = await mapper.mapEvent(
      event(4, {
        type: 'run.failed',
        status: 'failed',
        error: { code: 'WORKFLOW_LLM_FAILED', message: '模型失败。', retryable: true },
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'error',
      payload: {
        code: 'WORKFLOW_LLM_FAILED',
        retryable: true,
      },
    });
  });
});
