import { describe, expect, it } from 'vitest';
import {
  ChatMessageSchema,
  type ChatMessage,
  type CreativeBriefContent,
  type ProductionSpec,
  type WorkflowNodeId,
} from '@miaoma/video-project';
import type { WorkflowPublicState } from '../../../../shared/ipc-contract';
import {
  briefToSummaryItems,
  deriveGates,
  derivePlan,
  formatClockSeconds,
  formatOverviewDuration,
  gateStatusLabel,
  isChatMessageVisible,
  specToRows,
  toTimelineBeats,
} from './view-model';

const NOW = '2026-10-24T00:00:00.000Z';
const PROJECT_ID = 'project-1';
const RUN_ID = 'run-1';

const BRIEF: CreativeBriefContent = {
  audience: { description: '受众', needs: ['需求'], primary: '主要受众' },
  contentType: 'knowledge',
  coreMessage: { statement: '核心', supportingPoints: ['要点'] },
  coverageIssues: [],
  durationSeconds: 30,
  narrativeStructure: {
    type: 'hook_explain_cta',
    beats: [
      { estimatedSeconds: 10, label: '开场', purpose: '开场', summary: '开场' },
      { estimatedSeconds: 20, label: '解释', purpose: '解释', summary: '解释' },
    ],
  },
  openQuestions: [],
  style: { pacing: 'medium', toneKeywords: ['清晰'], visualTone: '明亮' },
  summary: '摘要',
  title: '标题',
  topic: '主题',
};

const SPEC: ProductionSpec = {
  schemaVersion: '1.0.0',
  specVersion: 1,
  contentFingerprint: 'abc',
  videoType: '知识口播',
  recommendedScheme: 'material_edit',
  visualStyle: '明亮',
  palette: { name: '自然', description: '低饱和' },
  font: { family: '思源黑体', usage: '字幕' },
  voiceProfile: {
    presetId: 'wenrou-xuejie',
    displayName: '温婉学姐',
    description: '柔和',
    speed: 1,
  },
  subtitleStyle: { presetId: 'white-outline', fontSize: 40 },
  materialStrategy: '素材匹配',
  rhythm: '平稳',
  deliverySpec: {
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrateKbps: 192,
    burnSubtitles: true,
  },
  aspectRatio: '16:9',
  resolution: '1920x1080',
  fps: 30,
  durationRange: { minSeconds: 24, maxSeconds: 36, targetSeconds: 30 },
  sourceAudioMuted: true,
  normalizationNotes: [],
};

function approval(id: string, version: number, gate: 'A1' | 'A2' | 'A3'): ChatMessage {
  return ChatMessageSchema.parse({
    id,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    role: 'assistant',
    type: 'approval_request',
    payload: {
      gate,
      artifact: {
        kind: 'creative_brief',
        ref: `analysis/brief/creative-brief.v${version}.json`,
        version,
        contentFingerprint: 'a'.repeat(64),
        createdAt: NOW,
      },
      title: `${gate} 待确认`,
      summary: '测试审批',
      prompt: '回复「确认」继续',
    },
    revision: version,
    status: 'completed',
    createdAt: NOW,
  });
}

function confirmation(approvalId: string, decision: 'approve' | 'request_changes'): ChatMessage {
  return ChatMessageSchema.parse({
    id: `confirm-${approvalId}`,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    role: 'user',
    type: 'user_confirmation',
    payload: {
      gate: 'A1',
      decision,
      rawText: decision === 'approve' ? '确认' : '改一下',
      ...(decision === 'request_changes' ? { feedback: '改一下' } : {}),
      artifact: {
        kind: 'creative_brief',
        ref: 'analysis/brief/creative-brief.v1.json',
        version: 1,
        contentFingerprint: 'a'.repeat(64),
        createdAt: NOW,
      },
      approvalMessageId: approvalId,
    },
    revision: 1,
    status: 'completed',
    createdAt: NOW,
  });
}

function execution(
  seq: number,
  phase: 'prepare' | 'storyboard',
  status: 'running' | 'succeeded' | 'waiting_user',
  nodeId?: WorkflowNodeId,
) {
  return ChatMessageSchema.parse({
    id: `exec-${seq}`,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    role: 'assistant',
    type: 'execution_update',
    payload: {
      phase,
      ...(nodeId ? { nodeId } : {}),
      status,
      detail: `${phase}-${status}`,
    },
    revision: 0,
    status: 'completed',
    createdAt: NOW,
  });
}

const workflow: WorkflowPublicState = {
  runId: RUN_ID,
  status: 'waiting_user',
  phaseStatus: {
    prepare: 'succeeded',
    storyboard: 'waiting_user',
    voice: 'pending',
    video: 'pending',
  },
  currentNodeId: 'scene_approval',
  pendingGate: 'A3',
  saved: false,
  contentRevision: 0,
  lastEventSeq: 10,
};

describe('create-chat view model', () => {
  it('derives the four-phase plan from workflow and execution updates', () => {
    const plan = derivePlan([execution(1, 'prepare', 'running')], workflow);

    expect(plan).toHaveLength(4);
    expect(plan[0]).toMatchObject({ id: '01', status: 'succeeded', tone: 'done' });
    expect(plan[1]).toMatchObject({ id: '02', status: 'waiting_user', tone: 'active' });
    expect(plan[2]).toMatchObject({ id: '03', status: 'pending', tone: 'pending' });
  });

  it('does not let historical waiting updates override the latest workflow status', () => {
    const completed: WorkflowPublicState = {
      ...workflow,
      status: 'succeeded',
      phaseStatus: {
        prepare: 'succeeded',
        storyboard: 'succeeded',
        voice: 'succeeded',
        video: 'succeeded',
      },
    };
    const plan = derivePlan(
      [
        execution(1, 'prepare', 'running', 'scan_assets'),
        execution(2, 'prepare', 'waiting_user', 'creative_brief'),
        execution(3, 'prepare', 'succeeded', 'creative_brief'),
        execution(4, 'storyboard', 'waiting_user', 'scene_approval'),
        execution(5, 'storyboard', 'succeeded', 'scene_approval'),
      ],
      completed,
    );

    expect(plan[0]).toMatchObject({
      status: 'succeeded',
      tone: 'done',
      detail: '已完成 · 创意简报',
    });
    expect(plan[1]).toMatchObject({
      status: 'succeeded',
      tone: 'done',
      detail: '已完成 · 分镜审批',
    });
  });

  it('tracks approval status and marks old versions stale', () => {
    const first = approval('a1-v1', 1, 'A1');
    const second = approval('a1-v2', 2, 'A1');
    const gates = deriveGates([first, confirmation(first.id, 'approve'), second]);

    expect(gates.get(first.id)?.status).toBe('stale');
    expect(gates.get(second.id)?.status).toBe('waiting');
    expect(gateStatusLabel('stale')).toBe('版本已更新');
  });

  it('derives brief time ranges and ten spec rows', () => {
    const items = briefToSummaryItems(BRIEF);

    expect(items[0]).toMatchObject({ range: '00:00–00:10', label: '开场' });
    expect(items[1]).toMatchObject({ range: '00:10–00:30', label: '解释' });
    expect(specToRows(SPEC)).toHaveLength(10);
    expect(specToRows(SPEC)[0]).toEqual({ label: '视频类型', value: '知识口播' });
    expect(formatClockSeconds(65)).toBe('01:05');
    expect(formatOverviewDuration(8)).toBe('约 8 秒');
    expect(formatOverviewDuration(65)).toBe('约 1 分 05 秒');
    expect(formatOverviewDuration(185)).toBe('约 3 分 05 秒');
  });

  it('formats timeline beats and stops ranges after a missing duration', () => {
    expect(
      toTimelineBeats([
        { label: '开场', estimatedSeconds: 5 },
        { label: '解释', estimatedSeconds: 20 },
      ]),
    ).toEqual([
      { label: '开场', range: '00:00–00:05' },
      { label: '解释', range: '00:05–00:25' },
    ]);
    expect(
      toTimelineBeats([
        { label: '开场', estimatedSeconds: 5 },
        { label: '解释' },
        { label: '收束', estimatedSeconds: 10 },
      ]),
    ).toEqual([{ label: '开场', range: '00:00–00:05' }, { label: '解释' }, { label: '收束' }]);
  });

  it('hides execution updates and artifact cards merged into approval gates', () => {
    const artifact = {
      kind: 'production_spec' as const,
      ref: 'analysis/spec/production-spec.v1.json',
      version: 1,
      contentFingerprint: 'b'.repeat(64),
      createdAt: NOW,
    };
    const messages = [
      execution(1, 'prepare', 'running'),
      ChatMessageSchema.parse({
        id: 'spec-1',
        projectId: PROJECT_ID,
        runId: RUN_ID,
        role: 'assistant',
        type: 'production_spec',
        payload: { spec: SPEC, artifact },
        revision: 1,
        status: 'completed',
        createdAt: NOW,
      }),
      ChatMessageSchema.parse({
        id: 'brief-1',
        projectId: PROJECT_ID,
        runId: RUN_ID,
        role: 'assistant',
        type: 'script_analysis',
        payload: {
          brief: BRIEF,
          briefVersion: 1,
          contentFingerprint: 'a'.repeat(64),
          artifact: { ...artifact, kind: 'creative_brief' },
        },
        revision: 1,
        status: 'completed',
        createdAt: NOW,
      }),
      approval('a2-v1', 1, 'A2'),
    ];

    expect(messages.filter(isChatMessageVisible).map((message) => message.type)).toEqual([
      'approval_request',
    ]);
  });
});
