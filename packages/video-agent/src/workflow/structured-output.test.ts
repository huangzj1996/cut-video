import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmError } from '../llm/errors';
import type {
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
} from '../llm/types';
import { StructuredOutputError, extractJsonObject, generateStructured } from './structured-output';

const schema = z.strictObject({
  title: z.string().min(1),
  count: z.number().int(),
});

class FakeProvider implements LlmProvider {
  readonly id = 'fake';
  readonly defaultModel = 'fake-model';
  readonly calls: { messages: readonly LlmMessage[]; options?: LlmGenerationOptions }[] = [];

  constructor(private readonly responses: Array<string | Error>) {}

  getCapabilities() {
    return {
      provider: 'fake',
      model: 'fake-model',
      streaming: false,
      reasoning: false,
    };
  }

  async generate(
    messages: readonly LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<LlmGenerationResult> {
    this.calls.push({ messages, options });
    const next = this.responses.shift();

    if (next instanceof Error) {
      throw next;
    }

    return {
      text: next ?? '',
      model: 'fake-model',
      finishReason: 'stop',
    };
  }

  async *stream(): AsyncGenerator<LlmStreamEvent, void, void> {
    yield* [];
    throw new Error('stream not used');
  }
}

function run(provider: FakeProvider) {
  return generateStructured({
    provider,
    schema,
    system: '你是测试助手。',
    user: '请生成标题和数量。',
    maxAttempts: 3,
  });
}

describe('extractJsonObject', () => {
  it('accepts plain, fenced and embedded JSON', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('结果如下：\n{"a":{"b":[1,2]}}\n请查收。')).toBe('{"a":{"b":[1,2]}}');
  });

  it('ignores braces inside strings and rejects malformed JSON', () => {
    expect(extractJsonObject('{"a":"}{"}')).toBe('{"a":"}{"}');
    expect(extractJsonObject('没有 JSON')).toBeNull();
    expect(extractJsonObject('{"a":')).toBeNull();
  });
});

describe('generateStructured', () => {
  it('returns validated data on the first attempt', async () => {
    const provider = new FakeProvider(['{"title":"标题","count":2}']);
    const result = await run(provider);

    expect(result.data).toEqual({ title: '标题', count: 2 });
    expect(result.attempts).toBe(1);
    expect(provider.calls[0]?.options?.responseFormat).toBe('json_object');
    expect(provider.calls[0]?.messages[0]?.content).toContain('JSON Schema');
  });

  it('repairs a schema failure within the budget', async () => {
    const provider = new FakeProvider(['{"title":"标题"}', '{"title":"标题","count":2}']);
    const result = await run(provider);

    expect(result.attempts).toBe(2);
    expect(provider.calls[1]?.messages.some((message) => message.content.includes('count'))).toBe(
      true,
    );
  });

  it('throws StructuredOutputError after exhausting attempts', async () => {
    const provider = new FakeProvider(['{"title":"标题"}', '{"title":"标题"}', '{"title":"标题"}']);

    await expect(run(provider)).rejects.toBeInstanceOf(StructuredOutputError);
    expect(provider.calls).toHaveLength(3);
  });

  it('retries retryable LLM errors within the same budget', async () => {
    const provider = new FakeProvider([
      new LlmError('LLM_RATE_LIMIT'),
      '{"title":"标题","count":2}',
    ]);
    const result = await run(provider);

    expect(result.attempts).toBe(2);
  });

  it('does not retry non-retryable LLM errors', async () => {
    const provider = new FakeProvider([new LlmError('LLM_AUTHENTICATION')]);

    await expect(run(provider)).rejects.toMatchObject({ code: 'LLM_AUTHENTICATION' });
    expect(provider.calls).toHaveLength(1);
  });

  it('falls back to prompt-only JSON when response_format is rejected', async () => {
    const provider = new FakeProvider([
      new LlmError('LLM_INVALID_REQUEST', 'response_format is not supported'),
      '{"title":"标题","count":2}',
    ]);
    const result = await run(provider);

    expect(result.attempts).toBe(2);
    expect(provider.calls[0]?.options?.responseFormat).toBe('json_object');
    expect(provider.calls[1]?.options?.responseFormat).toBeUndefined();
  });
});
