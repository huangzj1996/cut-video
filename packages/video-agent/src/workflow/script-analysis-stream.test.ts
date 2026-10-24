import { describe, expect, it } from 'vitest';
import type { ScriptAnalysisSectionsDraft } from '@miaoma/video-project';
import { LlmError } from '../llm/errors';
import type {
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
} from '../llm/types';
import {
  generateScriptAnalysisStreaming,
  parseScriptAnalysisSections,
} from './script-analysis-stream';

const FULL = [
  '<<<INTRO>>>',
  '我来分析你的文稿，这是一份结构清晰的教学稿。',
  '<<<STRUCTURE>>>',
  '这是一份完整的教学口播稿，包含 4 个时间段的内容：',
  '<<<SCRIPT_TYPE>>>',
  '文稿包含时间轴和画面描述，需要先转化为纯口播文稿。',
  '<<<VOICEOVER>>>',
  '第一段口播内容。',
  '',
  '第二段口播内容。',
  '<<<SCHEME>>>',
  '推荐素材匹配 + 基础剪辑（material_edit），使用现有素材按语义匹配画面。',
].join('\n');

describe('parseScriptAnalysisSections', () => {
  it('extracts all five sections in order', () => {
    expect(parseScriptAnalysisSections(FULL)).toEqual({
      intro: '我来分析你的文稿，这是一份结构清晰的教学稿。',
      structureIntro: '这是一份完整的教学口播稿，包含 4 个时间段的内容：',
      scriptType: '文稿包含时间轴和画面描述，需要先转化为纯口播文稿。',
      voiceoverScript: '第一段口播内容。\n\n第二段口播内容。',
      schemeRecommendation:
        '推荐素材匹配 + 基础剪辑（material_edit），使用现有素材按语义匹配画面。',
    });
  });

  it('keeps partial content and strips an incomplete marker', () => {
    const partial = ['<<<INTRO>>>', '正在分析文稿。', '<<<STRUCTURE>>>', '结构标题', '<<<SCR'].join(
      '\n',
    );

    expect(parseScriptAnalysisSections(partial)).toMatchObject({
      intro: '正在分析文稿。',
      structureIntro: '结构标题',
      scriptType: '',
      voiceoverScript: '',
      schemeRecommendation: '',
    });
  });

  it('returns empty strings for missing sections', () => {
    expect(parseScriptAnalysisSections('<<<INTRO>>>\n只有开场')).toMatchObject({
      intro: '只有开场',
      structureIntro: '',
      scriptType: '',
      voiceoverScript: '',
      schemeRecommendation: '',
    });
  });

  it('drops surrounding code fences', () => {
    const fenced = `\`\`\`text\n${FULL}\n\`\`\``;
    const parsed = parseScriptAnalysisSections(fenced);

    expect(parsed.intro).toBe('我来分析你的文稿，这是一份结构清晰的教学稿。');
    expect(parsed.schemeRecommendation).toContain('material_edit');
  });
});

class ChunkProvider implements LlmProvider {
  readonly id = 'fake';
  readonly defaultModel = 'fake-model';
  calls = 0;

  constructor(private readonly attempts: readonly (readonly string[])[]) {}

  getCapabilities() {
    return {
      provider: 'fake',
      model: 'fake-model',
      streaming: true,
      reasoning: false,
    };
  }

  async generate(
    _messages: readonly LlmMessage[],
    _options?: LlmGenerationOptions,
  ): Promise<LlmGenerationResult> {
    throw new Error('generate not used');
  }

  async *stream(
    _messages: readonly LlmMessage[],
    _options?: LlmGenerationOptions,
  ): AsyncGenerator<LlmStreamEvent, void, void> {
    const chunks = this.attempts[this.calls] ?? [];
    this.calls += 1;

    for (const delta of chunks) {
      yield { delta, type: 'content' };
    }

    const text = chunks.join('');
    yield {
      result: { finishReason: 'stop', model: 'fake-model', text },
      type: 'done',
    };
  }
}

class RetryableProvider extends ChunkProvider {
  private failed = false;

  override async *stream(
    messages: readonly LlmMessage[],
    options?: LlmGenerationOptions,
  ): AsyncGenerator<LlmStreamEvent, void, void> {
    if (!this.failed) {
      this.failed = true;
      throw new LlmError('LLM_RATE_LIMIT');
    }

    yield* super.stream(messages, options);
  }
}

describe('generateScriptAnalysisStreaming', () => {
  it('streams partial snapshots and returns validated content', async () => {
    const provider = new ChunkProvider([[FULL.slice(0, 30), FULL.slice(30, 200), FULL.slice(200)]]);
    const partials: ScriptAnalysisSectionsDraft[] = [];
    const result = await generateScriptAnalysisStreaming({
      provider,
      system: 'system',
      user: 'user',
      onPartial: (draft) => partials.push(draft),
    });

    expect(result.attempts).toBe(1);
    expect(result.content.voiceoverScript).toContain('第一段口播内容');
    expect(partials.at(-1)?.intro).toContain('我来分析你的文稿');
    expect(partials.at(-1)?.schemeRecommendation).toContain('material_edit');
  });

  it('retries with a new attempt when sections are missing', async () => {
    const provider = new ChunkProvider([['<<<INTRO>>>\n只有开场'], [FULL]]);
    const attempts: number[] = [];
    const result = await generateScriptAnalysisStreaming({
      provider,
      system: 'system',
      user: 'user',
      onPartial: (_draft, attempt) => attempts.push(attempt),
    });

    expect(provider.calls).toBe(2);
    expect(result.attempts).toBe(2);
    expect(attempts).toContain(1);
    expect(attempts).toContain(2);
    expect(result.content.scriptType).toContain('纯口播');
  });

  it('retries retryable provider errors within the shared budget', async () => {
    const provider = new RetryableProvider([[FULL]]);
    const result = await generateScriptAnalysisStreaming({
      provider,
      system: 'system',
      user: 'user',
    });

    expect(result.attempts).toBe(2);
    expect(result.content.schemeRecommendation).toContain('material_edit');
  });

  it('throws after exhausting the attempt budget', async () => {
    const provider = new ChunkProvider([['<<<INTRO>>>\n只有开场']]);

    await expect(
      generateScriptAnalysisStreaming({
        provider,
        system: 'system',
        user: 'user',
        maxAttempts: 1,
      }),
    ).rejects.toThrow(/文稿分析输出未通过校验/);
  });
});
