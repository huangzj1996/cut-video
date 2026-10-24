import { afterEach, describe, expect, it } from 'vitest';
import {
  createDeepSeekProvider,
  createDeepSeekProviderFromEnv,
  getDeepSeekCapabilities,
} from './deepseek';
import { toLlmErrorSummary } from './errors';
import {
  chatCompletion,
  createMockOpenAI,
  jsonResponse,
  openAiErrorBody,
  sseChunk,
  sseResponse,
  tokenUsage,
  usageChunk,
  type CapturedRequest,
} from './test-support/mock-openai';

const MESSAGES = [{ content: '你好', role: 'user' as const }];

function makeProvider(
  handler: (request: CapturedRequest, index: number) => Response | Promise<Response>,
  options: { timeoutMs?: number } = {},
) {
  const mock = createMockOpenAI(handler);
  const provider = createDeepSeekProvider({
    apiKey: 'sk-test-secret',
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    fetch: mock.fetch,
  });

  return { mock, provider };
}

const SAVED_ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
  OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID,
};

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('DeepSeek provider: generate', () => {
  it('sends a non-streaming chat request and maps text, reasoning, usage, and finish reason', async () => {
    const { mock, provider } = makeProvider(() =>
      jsonResponse(
        chatCompletion({
          content: '你好',
          reasoningContent: '先想一想',
          usage: tokenUsage(10, 5),
        }),
      ),
    );

    const result = await provider.generate(MESSAGES, {
      maxOutputTokens: 128,
      stop: ['END'],
      temperature: 0.3,
    });

    expect(result).toEqual({
      finishReason: 'stop',
      model: 'deepseek-chat',
      reasoning: '先想一想',
      text: '你好',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    const request = mock.requests[0];
    expect(request?.url).toBe('https://api.deepseek.com/chat/completions');
    expect(request?.headers.get('authorization')).toBe('Bearer sk-test-secret');
    expect(request?.body).toMatchObject({
      max_tokens: 128,
      messages: [{ content: '你好', role: 'user' }],
      model: 'deepseek-chat',
      stop: ['END'],
      stream: false,
      temperature: 0.3,
    });
  });

  it('passes response_format when JSON mode is requested', async () => {
    const { mock, provider } = makeProvider(() => jsonResponse(chatCompletion({ content: '{}' })));

    await provider.generate(MESSAGES, { responseFormat: 'json_object' });

    expect(mock.requests[0]?.body).toMatchObject({
      response_format: { type: 'json_object' },
    });
  });

  it('maps cached and reasoning tokens', async () => {
    const usage = tokenUsage(12, 8);
    usage.prompt_tokens_details = { cached_tokens: 4 };
    usage.completion_tokens_details = { reasoning_tokens: 3 };
    const { provider } = makeProvider(() => jsonResponse(chatCompletion({ content: 'ok', usage })));

    const result = await provider.generate(MESSAGES);

    expect(result.usage).toEqual({
      cachedInputTokens: 4,
      inputTokens: 12,
      outputTokens: 8,
      reasoningTokens: 3,
      totalTokens: 20,
    });
  });

  it('maps empty responses and length/content-filter finishes', async () => {
    const empty = makeProvider(() => jsonResponse(chatCompletion({ content: '' })));
    const truncated = makeProvider(() =>
      jsonResponse(chatCompletion({ content: '', finishReason: 'length' })),
    );
    const filtered = makeProvider(() =>
      jsonResponse(chatCompletion({ content: '', finishReason: 'content_filter' })),
    );
    const partial = makeProvider(() =>
      jsonResponse(chatCompletion({ content: '部分', finishReason: 'length' })),
    );

    await expect(empty.provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_EMPTY_RESPONSE',
      retryable: true,
    });
    await expect(truncated.provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_OUTPUT_TRUNCATED',
      retryable: false,
    });
    await expect(filtered.provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_CONTENT_FILTERED',
      retryable: false,
    });
    await expect(partial.provider.generate(MESSAGES)).resolves.toMatchObject({
      finishReason: 'length',
      text: '部分',
    });
  });
});

describe('DeepSeek provider: stream', () => {
  it('streams reasoning/content deltas, usage, and done result from SSE', async () => {
    const { mock, provider } = makeProvider(() =>
      sseResponse(
        [
          sseChunk({ reasoningContent: '思' }),
          sseChunk({ reasoningContent: '考' }),
          sseChunk({ content: '你' }),
          sseChunk({ content: '好' }),
          sseChunk({ finishReason: 'stop' }),
          usageChunk(tokenUsage(10, 5)),
          '[DONE]',
        ],
        { keepAlive: true, splitSize: 5 },
      ),
    );

    const events = [];

    for await (const event of provider.stream(MESSAGES)) {
      events.push(event);
    }

    expect(events).toEqual([
      { delta: '思', type: 'reasoning' },
      { delta: '考', type: 'reasoning' },
      { delta: '你', type: 'content' },
      { delta: '好', type: 'content' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      {
        result: {
          finishReason: 'stop',
          model: 'deepseek-chat',
          reasoning: '思考',
          text: '你好',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
        type: 'done',
      },
    ]);

    expect(mock.requests[0]?.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });
});

describe('DeepSeek provider: errors', () => {
  it.each([
    [401, 'LLM_AUTHENTICATION', false],
    [402, 'LLM_INSUFFICIENT_BALANCE', false],
    [403, 'LLM_PERMISSION_DENIED', false],
    [404, 'LLM_MODEL_NOT_FOUND', false],
    [422, 'LLM_INVALID_REQUEST', false],
    [500, 'LLM_SERVER_ERROR', true],
    [503, 'LLM_SERVER_ERROR', true],
  ] as const)('maps HTTP %i to %s without retrying', async (status, code, retryable) => {
    const { mock, provider } = makeProvider(() =>
      jsonResponse(openAiErrorBody('provider failure'), status),
    );

    await expect(provider.generate(MESSAGES)).rejects.toMatchObject({ code, retryable });
    expect(mock.requests).toHaveLength(1);
  });

  it('maps context overflow and rate limits', async () => {
    const context = makeProvider(() =>
      jsonResponse(openAiErrorBody('maximum context length exceeded'), 400),
    );
    const rate = makeProvider(() =>
      jsonResponse(openAiErrorBody('slow down', 'rate_limit_error'), 429, {
        'retry-after': '2',
      }),
    );

    await expect(context.provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_CONTEXT_OVERFLOW',
    });
    await expect(rate.provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_RATE_LIMIT',
      details: { retryAfterMs: 2_000 },
      retryable: true,
    });
    expect(rate.mock.requests).toHaveLength(1);
  });

  it('maps network failures without retrying', async () => {
    const { mock, provider } = makeProvider(() => {
      throw new TypeError('fetch failed');
    });

    await expect(provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_NETWORK_ERROR',
      retryable: true,
    });
    expect(mock.requests).toHaveLength(1);
  });

  it('times out via the local controller', async () => {
    const { mock, provider } = makeProvider(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = (): void => reject(new DOMException('Aborted', 'AbortError'));

          if (request.signal?.aborted) {
            abort();
          } else {
            request.signal?.addEventListener('abort', abort, { once: true });
          }
        }),
      { timeoutMs: 20 },
    );

    await expect(provider.generate(MESSAGES)).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
      retryable: true,
    });
    expect(mock.requests).toHaveLength(1);
  });

  it('does not call the network when the signal is already aborted', async () => {
    const { mock, provider } = makeProvider(() =>
      jsonResponse(chatCompletion({ content: 'unused' })),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(provider.generate(MESSAGES, { signal: controller.signal })).rejects.toMatchObject({
      code: 'LLM_ABORTED',
    });
    expect(mock.requests).toHaveLength(0);
  });

  it('does not leak secrets or prompts into summaries', async () => {
    const { provider } = makeProvider(() =>
      jsonResponse(openAiErrorBody('sk-test-secret /secret/path prompt text'), 500),
    );

    let caught: unknown;

    try {
      await provider.generate([{ content: 'prompt text', role: 'user' }]);
    } catch (error) {
      caught = error;
    }

    const summary = toLlmErrorSummary(caught);
    expect(summary.code).toBe('LLM_SERVER_ERROR');
    expect(JSON.stringify(summary)).not.toContain('sk-test-secret');
    expect(JSON.stringify(summary)).not.toContain('/secret/path');
    expect(JSON.stringify(summary)).not.toContain('prompt text');
  });
});

describe('DeepSeek provider: config and environment', () => {
  it('validates config and per-call options', () => {
    expect(() => createDeepSeekProvider({ apiKey: '  ' })).toThrowError(
      expect.objectContaining({ code: 'LLM_CONFIG_MISSING_API_KEY' }),
    );
    expect(() => createDeepSeekProvider({ apiKey: 'k', baseURL: 'ftp://x' })).toThrowError(
      expect.objectContaining({ code: 'LLM_CONFIG_INVALID' }),
    );
    expect(() => createDeepSeekProvider({ apiKey: 'k', temperature: 3 })).toThrowError(
      expect.objectContaining({ code: 'LLM_CONFIG_INVALID' }),
    );
    expect(() => createDeepSeekProvider({ apiKey: 'k', maxOutputTokens: 0 })).toThrowError(
      expect.objectContaining({ code: 'LLM_CONFIG_INVALID' }),
    );
  });

  it('never falls back to OPENAI_API_KEY and blocks OpenAI org/project headers', async () => {
    process.env.OPENAI_API_KEY = 'openai-leak';
    process.env.OPENAI_ORG_ID = 'leak-org';
    process.env.OPENAI_PROJECT_ID = 'leak-project';

    expect(() => createDeepSeekProvider({ apiKey: ' ' })).toThrowError(
      expect.objectContaining({ code: 'LLM_CONFIG_MISSING_API_KEY' }),
    );

    const { mock, provider } = makeProvider(() => jsonResponse(chatCompletion({ content: 'ok' })));
    await provider.generate(MESSAGES);

    const request = mock.requests[0];
    expect(request?.headers.get('authorization')).toBe('Bearer sk-test-secret');
    expect(request?.headers.get('openai-organization')).toBeNull();
    expect(request?.headers.get('openai-project')).toBeNull();
  });

  it('reads DEEPSEEK_* environment values and reports capabilities', () => {
    const provider = createDeepSeekProviderFromEnv({
      DEEPSEEK_API_KEY: ' env-key ',
      DEEPSEEK_BASE_URL: 'https://example.test',
      DEEPSEEK_MODEL: 'deepseek-reasoner',
    });

    expect(provider.id).toBe('deepseek');
    expect(provider.defaultModel).toBe('deepseek-reasoner');
    expect(provider.getCapabilities()).toEqual({
      model: 'deepseek-reasoner',
      provider: 'deepseek',
      reasoning: true,
      streaming: true,
    });
    expect(getDeepSeekCapabilities('deepseek-chat')).toEqual({
      model: 'deepseek-chat',
      provider: 'deepseek',
      reasoning: false,
      streaming: true,
    });

    expect(() => createDeepSeekProviderFromEnv({})).toThrowError(
      expect.objectContaining({ code: 'LLM_CONFIG_MISSING_API_KEY' }),
    );
  });
});
