import { describe, expect, it } from 'vitest';
import { CreativeBriefContentSchema } from '@miaoma/video-project';
import { buildProductionSpec } from './production-spec';

const brief = CreativeBriefContentSchema.parse({
  audience: {
    description: '测试受众',
    needs: ['理解核心信息'],
    primary: '测试用户',
  },
  contentType: 'knowledge',
  coreMessage: {
    statement: '核心信息',
    supportingPoints: ['要点一', '要点二'],
  },
  coverageIssues: [],
  durationSeconds: 60,
  narrativeStructure: {
    type: 'hook_explain_cta',
    beats: [
      { estimatedSeconds: 30, label: '开场', purpose: '开场', summary: '开场' },
      { estimatedSeconds: 30, label: '解释', purpose: '解释', summary: '解释' },
    ],
  },
  openQuestions: [],
  style: { pacing: 'fast', toneKeywords: ['清晰'], visualTone: '明亮自然' },
  summary: '测试简报',
  title: '测试视频',
  topic: '测试主题',
});

describe('buildProductionSpec', () => {
  it('locks v1 delivery settings and derives duration range', () => {
    const spec = buildProductionSpec({
      brief,
      voicePresetId: 'wenrou-xuejie',
      specVersion: 3,
    });

    expect(spec.specVersion).toBe(3);
    expect(spec.recommendedScheme).toBe('material_edit');
    expect(spec.aspectRatio).toBe('16:9');
    expect(spec.resolution).toBe('1920x1080');
    expect(spec.fps).toBe(30);
    expect(spec.sourceAudioMuted).toBe(true);
    expect(spec.durationRange).toEqual({
      minSeconds: 51,
      maxSeconds: 69,
      targetSeconds: 60,
    });
    expect(spec.voiceProfile).toMatchObject({
      presetId: 'wenrou-xuejie',
      displayName: '温婉学姐',
    });
    expect(spec.contentFingerprint).toHaveLength(64);
  });
});
