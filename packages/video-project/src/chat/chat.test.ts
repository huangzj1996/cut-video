import { describe, expect, it } from 'vitest';
import { ChatLogSchema, ChatMessageSchema } from './index';

const NOW = '2026-10-24T00:00:00.000Z';

function artifact(kind: string, ref: string, version = 1) {
  return {
    kind,
    ref,
    version,
    contentFingerprint: 'a'.repeat(64),
    createdAt: NOW,
  };
}

function briefContent() {
  return {
    audience: {
      description: '想快速了解咖啡烘焙的入门爱好者。',
      needs: ['理解烘焙度与风味的关系'],
      primary: '刚接触手冲咖啡的人',
    },
    contentType: 'knowledge',
    coreMessage: {
      statement: '烘焙度越深，酸味越弱。',
      supportingPoints: ['浅烘保留花果酸香', '深烘突出焦糖风味'],
    },
    coverageIssues: [],
    durationSeconds: 30,
    narrativeStructure: {
      type: 'hook_explain_cta',
      beats: [
        {
          estimatedSeconds: 15,
          label: '开场',
          purpose: '建立问题',
          summary: '为什么同一款豆子味道不同？',
        },
        {
          estimatedSeconds: 15,
          label: '解释',
          purpose: '给出结论',
          summary: '烘焙度决定酸苦平衡。',
        },
      ],
    },
    openQuestions: [],
    style: { pacing: 'medium', toneKeywords: ['清晰'], visualTone: '明亮自然' },
    summary: '用 30 秒解释烘焙度与风味的关系。',
    title: '烘焙度入门',
    topic: '咖啡烘焙度',
  };
}

function spec() {
  return {
    schemaVersion: '1.0.0',
    specVersion: 1,
    contentFingerprint: 'abc',
    videoType: '知识口播',
    recommendedScheme: 'material_edit',
    visualStyle: '简洁明亮',
    palette: { name: '中性自然', description: '低饱和暖色' },
    font: { family: '思源黑体', usage: '字幕与标题' },
    voiceProfile: {
      presetId: 'wenrou-xuejie',
      displayName: '温婉学姐',
      description: '柔和亲切',
      speed: 1,
    },
    subtitleStyle: { presetId: 'white-outline', fontSize: 40 },
    materialStrategy: '按分镜语义匹配已导入素材',
    rhythm: '短句、快节奏',
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
}

function base(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    projectId: 'project-1',
    revision: 0,
    status: 'completed',
    createdAt: NOW,
    ...overrides,
  };
}

const validMessages = [
  base({
    role: 'user',
    type: 'user_requirement',
    payload: {
      kind: 'initial_request',
      script: '一段口播文稿。',
      voicePresetId: 'wenrou-xuejie',
      assetCount: 3,
      tags: [{ group: 'visual', values: ['视频画面', '智能匹配素材'] }],
    },
  }),
  base({
    role: 'user',
    type: 'user_confirmation',
    payload: {
      gate: 'A1',
      decision: 'approve',
      rawText: '确认',
      artifact: artifact('creative_brief', 'analysis/brief/creative-brief.v1.json'),
      approvalMessageId: 'approval-1',
    },
  }),
  base({
    role: 'assistant',
    type: 'script_analysis',
    payload: {
      brief: briefContent(),
      briefVersion: 1,
      contentFingerprint: 'a'.repeat(64),
      artifact: artifact('creative_brief', 'analysis/brief/creative-brief.v1.json'),
    },
  }),
  base({
    role: 'assistant',
    type: 'script_rewrite',
    payload: {
      content: {
        title: '纯口播稿',
        paragraphs: ['一段口播文稿。'],
        changeNotes: ['去除画面提示'],
      },
      sourceBrief: artifact('creative_brief', 'analysis/brief/creative-brief.v1.json'),
      rewriteVersion: 1,
      contentFingerprint: 'a'.repeat(64),
    },
  }),
  base({
    role: 'assistant',
    type: 'scheme_recommendation',
    payload: {
      recommendedScheme: 'material_edit',
      summary: '使用素材匹配 + 基础剪辑。',
      reasons: ['已有可用素材'],
      candidates: [
        { id: 'material_edit', label: '素材匹配 + 基础剪辑', summary: '使用本地素材直切。' },
      ],
      sourceBrief: artifact('creative_brief', 'analysis/brief/creative-brief.v1.json'),
      normalizationNotes: [],
    },
  }),
  base({
    role: 'assistant',
    type: 'production_spec',
    payload: {
      spec: spec(),
      artifact: artifact('production_spec', 'analysis/spec/production-spec.v1.json'),
    },
  }),
  base({
    role: 'assistant',
    type: 'approval_request',
    payload: {
      gate: 'A3',
      artifact: artifact('scene_plan', 'analysis/scenes/scene-plan.v1.json'),
      title: '分镜待确认',
      summary: '共 1 个分镜，预计 30 秒。',
      prompt: '回复「确认」继续，或直接说明要修改的内容',
    },
  }),
  base({
    role: 'assistant',
    type: 'execution_update',
    payload: {
      phase: 'prepare',
      nodeId: 'scan_assets',
      status: 'running',
      detail: '正在扫描素材',
    },
  }),
  base({
    role: 'assistant',
    type: 'video_overview',
    payload: {
      title: '烘焙度入门',
      description: '30 秒知识口播。',
      durationSeconds: 30,
      exportStatus: 'not_exported',
      projectRevision: 1,
      spec: artifact('production_spec', 'analysis/spec/production-spec.v1.json'),
      project: artifact('video_project', 'analysis/timeline/video-project.v1.json'),
    },
  }),
  base({
    role: 'assistant',
    type: 'error',
    payload: {
      code: 'LLM_NOT_CONFIGURED',
      message: '模型未配置。',
      retryable: false,
    },
  }),
  base({
    role: 'system',
    type: 'system_notice',
    payload: {
      level: 'info',
      message: '当前为模拟配音，时长按文本估算。',
    },
  }),
];

describe('chat message schema', () => {
  it('accepts all eleven message types', () => {
    expect(validMessages).toHaveLength(11);

    for (const message of validMessages) {
      const parsed = ChatMessageSchema.safeParse(message);

      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('rejects a role that does not match the message type', () => {
    const invalid = {
      ...validMessages[2],
      role: 'user',
    };

    expect(ChatMessageSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects display-only fields on payloads', () => {
    const invalid = {
      ...validMessages[0],
      payload: {
        kind: 'initial_request',
        script: '一段口播文稿。',
        voicePresetId: 'wenrou-xuejie',
        tags: [{ group: 'visual', values: ['视频画面'] }],
        tone: 'blue',
      },
    };

    expect(ChatMessageSchema.safeParse(invalid).success).toBe(false);
  });

  it('requires feedback when requesting changes', () => {
    const invalid = {
      ...validMessages[1],
      payload: {
        gate: 'A1',
        decision: 'request_changes',
        rawText: '改一下',
        artifact: artifact('creative_brief', 'analysis/brief/creative-brief.v1.json'),
        approvalMessageId: 'approval-1',
      },
    };

    expect(ChatMessageSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('chat log schema', () => {
  it('accepts a log with unique messages', () => {
    expect(
      ChatLogSchema.safeParse({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        messages: validMessages.map((message, index) => ({
          ...message,
          id: `message-${index + 1}`,
        })),
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate ids and mismatched project ids', () => {
    expect(
      ChatLogSchema.safeParse({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        messages: [validMessages[0], validMessages[0]],
      }).success,
    ).toBe(false);

    expect(
      ChatLogSchema.safeParse({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        messages: [{ ...validMessages[0], projectId: 'project-2' }],
      }).success,
    ).toBe(false);
  });
});
