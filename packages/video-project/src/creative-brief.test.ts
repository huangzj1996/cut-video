import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CREATIVE_BRIEF_SCHEMA_VERSION,
  CreativeBriefContentSchema,
  CreativeBriefSchema,
} from './index';

function createValidBriefContent() {
  return {
    audience: {
      description: '对咖啡风味有好奇，但缺少系统认知，习惯用短视频获取知识。',
      needs: ['快速理解烘焙度与风味的关系', '获得可执行的选择建议'],
      primary: '刚接触手冲咖啡的入门爱好者',
    },
    contentType: 'knowledge',
    coreMessage: {
      callToAction: '下次买咖啡豆时，先看烘焙度再选风味。',
      statement: '烘焙度越深，酸味越弱、苦味和焦糖感越强。',
      supportingPoints: ['浅烘保留花果酸香', '中烘平衡酸苦', '深烘突出焦糖和坚果风味'],
    },
    coverageIssues: [
      {
        description: '缺少咖啡豆烘焙过程的素材。',
        severity: 'warning',
        suggestion: '用现有咖啡豆特写替换，或用文字卡补充说明。',
        type: 'missing_material',
      },
    ],
    durationSeconds: 60,
    narrativeStructure: {
      beats: [
        {
          estimatedSeconds: 8,
          label: '开场提问',
          purpose: '用常见困惑抓住注意力',
          summary: '为什么同一款豆子喝起来差别很大？',
        },
        {
          estimatedSeconds: 22,
          label: '解释烘焙度',
          purpose: '建立核心概念',
          summary: '浅烘、中烘、深烘对应的颜色和风味变化。',
        },
        {
          estimatedSeconds: 20,
          label: '给出选择建议',
          purpose: '把知识转成行动',
          summary: '按口味偏好选择烘焙度。',
        },
        {
          estimatedSeconds: 10,
          label: '收束',
          purpose: '强化记忆点',
          summary: '回顾核心信息并引导下次购买。',
        },
      ],
      type: 'hook_explain_cta',
    },
    openQuestions: ['是否接受用文字卡补充烘焙过程？'],
    style: {
      pacing: 'medium',
      toneKeywords: ['轻松', '专业', '生活化'],
      visualTone: '温暖的咖啡馆色调，以咖啡豆和手冲特写为主。',
    },
    summary: '用 60 秒解释浅烘、中烘、深烘的风味差异，并给出初学者选择建议。',
    title: '烘焙度如何决定一杯咖啡的味道',
    topic: '咖啡豆烘焙度与风味的关系',
  };
}

function createValidBrief() {
  return {
    ...createValidBriefContent(),
    briefVersion: 1,
    generatedAt: '2026-10-24T00:00:00Z',
    inputFingerprint: 'sha256:fixture',
    schemaVersion: CREATIVE_BRIEF_SCHEMA_VERSION,
  };
}

describe('CreativeBriefContentSchema', () => {
  it('accepts a valid creative brief', () => {
    const result = CreativeBriefContentSchema.safeParse(createValidBriefContent());

    expect(result.success).toBe(true);
  });

  it('rejects a missing required field and reports its path', () => {
    const brief = createValidBriefContent() as Record<string, unknown>;
    delete brief.coreMessage;

    const result = CreativeBriefContentSchema.safeParse(brief);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['coreMessage'] })]),
      );
    }
  });

  it('rejects unsupported enum values', () => {
    const brief = createValidBriefContent();
    brief.style.pacing = 'very-fast';

    const result = CreativeBriefContentSchema.safeParse(brief);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['style', 'pacing'] })]),
      );
    }
  });

  it('rejects narrative beats whose total duration is far from the target', () => {
    const brief = createValidBriefContent();
    brief.narrativeStructure.beats = brief.narrativeStructure.beats.map((beat, index) =>
      index === 1 ? { ...beat, estimatedSeconds: 100 } : beat,
    );

    const result = CreativeBriefContentSchema.safeParse(brief);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['narrativeStructure', 'beats'] }),
        ]),
      );
    }
  });

  it('trims text and rejects whitespace-only values', () => {
    const brief = createValidBriefContent();
    brief.title = '  烘焙度如何决定一杯咖啡的味道  ';

    const trimmed = CreativeBriefContentSchema.safeParse(brief);
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.title).toBe('烘焙度如何决定一杯咖啡的味道');
    }

    brief.title = '   ';
    expect(CreativeBriefContentSchema.safeParse(brief).success).toBe(false);
  });

  it('strips unknown fields instead of failing on them', () => {
    const result = CreativeBriefContentSchema.safeParse({
      ...createValidBriefContent(),
      unexpected: 'ignored',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect('unexpected' in result.data).toBe(false);
    }
  });

  it('keeps the prompt example valid against the schema', () => {
    const markdown = readFileSync(
      new URL('../../../.agents/prompts/creative-brief.md', import.meta.url),
      'utf8',
    );
    const match = /### 示例输出\s+```json\s+([\s\S]*?)```/.exec(markdown);

    if (match === null || match[1] === undefined) {
      throw new Error('creative-brief.md is missing the example output block');
    }

    const result = CreativeBriefContentSchema.safeParse(JSON.parse(match[1]) as unknown);

    expect(result.success).toBe(true);
  });
});

describe('CreativeBriefSchema', () => {
  it('accepts a stored brief with version metadata', () => {
    const result = CreativeBriefSchema.safeParse(createValidBrief());

    expect(result.success).toBe(true);
  });

  it('requires briefVersion, fingerprint and generatedAt', () => {
    const brief = createValidBrief() as Record<string, unknown>;
    delete brief.briefVersion;
    delete brief.inputFingerprint;
    delete brief.generatedAt;

    const result = CreativeBriefSchema.safeParse(brief);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining(['briefVersion', 'inputFingerprint', 'generatedAt']),
      );
    }
  });
});
