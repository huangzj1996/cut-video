import { describe, expect, it } from 'vitest';
import {
  ChatStreamEventSchema,
  ScriptAnalysisContentSchema,
  ScriptAnalysisDraftSchema,
} from './index';

const NOW = '2026-10-24T00:00:00.000Z';

const ANALYSIS = {
  intro: '我来分析你的文稿，这是一份结构清晰的教学稿。',
  structureIntro: '这是一份完整的教学口播稿，包含 2 个时间段的内容：',
  scriptType: '文稿包含时间轴，需要先转化为纯口播文稿。',
  voiceoverScript: '第一段口播。\n\n第二段口播。',
  schemeRecommendation: '推荐素材匹配 + 基础剪辑（material_edit）。',
};

describe('script analysis contracts', () => {
  it('validates the five final sections', () => {
    expect(ScriptAnalysisContentSchema.safeParse(ANALYSIS).success).toBe(true);
  });

  it('rejects incomplete final sections', () => {
    const { intro: _intro, ...withoutIntro } = ANALYSIS;

    expect(ScriptAnalysisContentSchema.safeParse(withoutIntro).success).toBe(false);
    expect(ScriptAnalysisContentSchema.safeParse({ ...ANALYSIS, intro: '   ' }).success).toBe(
      false,
    );
  });

  it('allows empty sections and partial beats while streaming', () => {
    expect(
      ScriptAnalysisDraftSchema.safeParse({
        intro: '',
        structureIntro: '',
        scriptType: '',
        voiceoverScript: '',
        schemeRecommendation: '',
        beats: [{ label: '开场' }, { label: '解释', estimatedSeconds: 12 }],
      }).success,
    ).toBe(true);
  });

  it('validates chat stream snapshots', () => {
    const event = {
      schemaVersion: '1.0.0',
      projectId: 'project-1',
      runId: 'run-1',
      nodeId: 'creative_brief',
      streamId: 'run-1:script-analysis',
      attempt: 1,
      draft: {
        ...ANALYSIS,
        beats: [{ label: '开场', estimatedSeconds: 5 }],
      },
      done: false,
      timestamp: NOW,
    };

    expect(ChatStreamEventSchema.safeParse(event).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({ ...event, attempt: 0 }).success).toBe(false);
  });
});
