import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { LlmError, mapLlmError } from './errors';
import { toLangChainMessages } from './messages';
import type {
  LlmFinishReason,
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider,
  LlmProviderCapabilities,
  LlmStreamEvent,
  LlmUsage,
} from './types';

export const DEEPSEEK_DEFAULTS = {
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  timeoutMs: 120_000,
} as const;

export interface DeepSeekProviderConfig {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

const ROLES = new Set(['system', 'user', 'assistant']);

interface CallContext {
  readonly signal: AbortSignal;
  abort(): void;
  cleanup(): void;
  timedOut(): boolean;
  userAborted(): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: unknown, key: string): string | undefined {
  if (!isRecord(record)) {
    return undefined;
  }

  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(record: unknown, key: string): number | undefined {
  if (!isRecord(record)) {
    return undefined;
  }

  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function invalidRequest(field: string): LlmError {
  return new LlmError('LLM_INVALID_REQUEST', undefined, false, { field });
}

function invalidConfig(field: string): LlmError {
  return new LlmError('LLM_CONFIG_INVALID', undefined, false, { field });
}

function normalizeApiKey(raw: string): string {
  const apiKey = raw.trim();

  if (apiKey.length === 0) {
    throw new LlmError('LLM_CONFIG_MISSING_API_KEY');
  }

  return apiKey;
}

function normalizeBaseURL(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw invalidConfig('baseURL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidConfig('baseURL');
  }

  return url.toString().replace(/\/+$/, '');
}

function normalizeModel(raw: string): string {
  const model = raw.trim();

  if (model.length === 0) {
    throw invalidConfig('model');
  }

  return model;
}

function normalizeTemperature(raw: number | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!Number.isFinite(raw) || raw < 0 || raw > 2) {
    throw invalidConfig('temperature');
  }

  return raw;
}

function normalizeMaxOutputTokens(raw: number | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!Number.isInteger(raw) || raw <= 0) {
    throw invalidConfig('maxOutputTokens');
  }

  return raw;
}

function normalizeTimeout(raw: number | undefined): number {
  const timeoutMs = raw ?? DEEPSEEK_DEFAULTS.timeoutMs;

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw invalidConfig('timeoutMs');
  }

  return timeoutMs;
}

function validateMessages(messages: readonly LlmMessage[]): void {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalidRequest('messages');
  }

  messages.forEach((message, index) => {
    if (!isRecord(message) || typeof message.role !== 'string' || !ROLES.has(message.role)) {
      throw invalidRequest(`messages[${index}].role`);
    }

    if (typeof message.content !== 'string' || message.content.trim().length === 0) {
      throw invalidRequest(`messages[${index}].content`);
    }
  });
}

function validateGenerationOptions(options: LlmGenerationOptions): void {
  if (
    options.model !== undefined &&
    (typeof options.model !== 'string' || options.model.trim().length === 0)
  ) {
    throw invalidRequest('model');
  }

  if (
    options.temperature !== undefined &&
    (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)
  ) {
    throw invalidRequest('temperature');
  }

  if (
    options.maxOutputTokens !== undefined &&
    (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0)
  ) {
    throw invalidRequest('maxOutputTokens');
  }

  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw invalidRequest('timeoutMs');
  }

  if (options.stop !== undefined) {
    if (
      !Array.isArray(options.stop) ||
      options.stop.some((entry) => typeof entry !== 'string' || entry.length === 0)
    ) {
      throw invalidRequest('stop');
    }
  }

  if (options.responseFormat !== undefined && options.responseFormat !== 'json_object') {
    throw invalidRequest('responseFormat');
  }
}

function createCallContext(userSignal: AbortSignal | undefined, timeoutMs: number): CallContext {
  const controller = new AbortController();
  let timedOut = false;
  let userAborted = false;

  const onAbort = (): void => {
    userAborted = true;
    controller.abort();
  };

  if (userSignal) {
    if (userSignal.aborted) {
      userAborted = true;
      controller.abort();
    } else {
      userSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    abort: () => controller.abort(),
    cleanup: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onAbort);
    },
    signal: controller.signal,
    timedOut: () => timedOut,
    userAborted: () => userAborted,
  };
}

function mapUsage(value: unknown): LlmUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = readNumber(value, 'input_tokens');
  const outputTokens = readNumber(value, 'output_tokens');
  const totalTokens = readNumber(value, 'total_tokens');
  const cachedInputTokens = isRecord(value.input_token_details)
    ? readNumber(value.input_token_details, 'cache_read')
    : undefined;
  const reasoningTokens = isRecord(value.output_token_details)
    ? readNumber(value.output_token_details, 'reasoning')
    : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

function mapFinishReason(value: unknown): LlmFinishReason {
  switch (value) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

function getReasoning(message: BaseMessage): string | undefined {
  return readString(message.additional_kwargs, 'reasoning_content');
}

function toGenerationResult(message: BaseMessage, fallbackModel: string): LlmGenerationResult {
  const usage = mapUsage((message as AIMessage).usage_metadata);
  const reasoning = getReasoning(message);
  const model = readString(message.response_metadata, 'model_name') ?? fallbackModel;

  return {
    finishReason: mapFinishReason(readString(message.response_metadata, 'finish_reason')),
    model,
    ...(reasoning !== undefined ? { reasoning } : {}),
    text: message.text,
    ...(usage !== undefined ? { usage } : {}),
  };
}

function assertTextResult(result: LlmGenerationResult): void {
  if (result.text.trim().length > 0) {
    return;
  }

  if (result.finishReason === 'length') {
    throw new LlmError('LLM_OUTPUT_TRUNCATED', undefined, false, { finishReason: 'length' });
  }

  if (result.finishReason === 'content_filter') {
    throw new LlmError('LLM_CONTENT_FILTERED', undefined, false, {
      finishReason: 'content_filter',
    });
  }

  throw new LlmError('LLM_EMPTY_RESPONSE', undefined, true, {
    finishReason: result.finishReason,
  });
}

export function getDeepSeekCapabilities(
  model: string = DEEPSEEK_DEFAULTS.model,
): LlmProviderCapabilities {
  return {
    model,
    provider: 'deepseek',
    reasoning: /reasoner|thinking/i.test(model),
    streaming: true,
  };
}

export function createDeepSeekProvider(config: DeepSeekProviderConfig): LlmProvider {
  const apiKey = normalizeApiKey(config.apiKey);
  const baseURL = normalizeBaseURL(config.baseURL ?? DEEPSEEK_DEFAULTS.baseURL);
  const defaultModel = normalizeModel(config.model ?? DEEPSEEK_DEFAULTS.model);
  const defaultTemperature = normalizeTemperature(config.temperature);
  const defaultMaxOutputTokens = normalizeMaxOutputTokens(config.maxOutputTokens);
  const defaultTimeoutMs = normalizeTimeout(config.timeoutMs);
  const fetchImpl = config.fetch;
  const modelCache = new Map<string, ChatOpenAI>();

  function resolveModel(options: LlmGenerationOptions): string {
    return normalizeModel(options.model ?? defaultModel);
  }

  function resolveTemperature(options: LlmGenerationOptions): number | undefined {
    return options.temperature ?? defaultTemperature;
  }

  function resolveMaxOutputTokens(options: LlmGenerationOptions): number | undefined {
    return options.maxOutputTokens ?? defaultMaxOutputTokens;
  }

  function getModel(
    model: string,
    temperature: number | undefined,
    maxOutputTokens: number | undefined,
    responseFormat: LlmGenerationOptions['responseFormat'],
  ): ChatOpenAI {
    const cacheKey = JSON.stringify([
      model,
      temperature ?? null,
      maxOutputTokens ?? null,
      responseFormat ?? null,
    ]);
    const cached = modelCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const instance = new ChatOpenAI({
      apiKey,
      maxRetries: 0,
      model,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
      ...(responseFormat !== undefined
        ? { modelKwargs: { response_format: { type: responseFormat } } }
        : {}),
      configuration: {
        baseURL,
        organization: null,
        project: null,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      },
    });

    modelCache.set(cacheKey, instance);
    return instance;
  }

  return {
    defaultModel,

    async generate(
      messages: readonly LlmMessage[],
      options: LlmGenerationOptions = {},
    ): Promise<LlmGenerationResult> {
      validateMessages(messages);
      validateGenerationOptions(options);

      const model = resolveModel(options);
      const modelInstance = getModel(
        model,
        resolveTemperature(options),
        resolveMaxOutputTokens(options),
        options.responseFormat,
      );
      const call = createCallContext(options.signal, options.timeoutMs ?? defaultTimeoutMs);

      if (options.signal?.aborted) {
        call.cleanup();
        throw new LlmError('LLM_ABORTED');
      }

      try {
        const raw = await modelInstance.invoke(toLangChainMessages(messages), {
          signal: call.signal,
          ...(options.stop ? { stop: [...options.stop] } : {}),
        });
        const result = toGenerationResult(raw, model);

        if (call.timedOut()) {
          throw new LlmError('LLM_TIMEOUT');
        }

        if (call.userAborted()) {
          throw new LlmError('LLM_ABORTED');
        }

        assertTextResult(result);
        return result;
      } catch (error) {
        if (call.timedOut()) {
          throw new LlmError('LLM_TIMEOUT');
        }

        if (call.userAborted()) {
          throw new LlmError('LLM_ABORTED');
        }

        throw mapLlmError(error);
      } finally {
        call.cleanup();
      }
    },

    getCapabilities: (model?: string): LlmProviderCapabilities =>
      getDeepSeekCapabilities(model ?? defaultModel),

    id: 'deepseek',

    async *stream(
      messages: readonly LlmMessage[],
      options: LlmGenerationOptions = {},
    ): AsyncGenerator<LlmStreamEvent, void, void> {
      validateMessages(messages);
      validateGenerationOptions(options);

      const model = resolveModel(options);
      const modelInstance = getModel(
        model,
        resolveTemperature(options),
        resolveMaxOutputTokens(options),
        options.responseFormat,
      );
      const call = createCallContext(options.signal, options.timeoutMs ?? defaultTimeoutMs);

      if (options.signal?.aborted) {
        call.cleanup();
        throw new LlmError('LLM_ABORTED');
      }

      let completed = false;
      let text = '';
      let reasoning = '';
      let usage: LlmUsage | undefined;
      let finishReason: LlmFinishReason = 'unknown';

      try {
        const stream = await modelInstance.stream(toLangChainMessages(messages), {
          signal: call.signal,
          ...(options.stop ? { stop: [...options.stop] } : {}),
        });

        for await (const chunk of stream) {
          const reasoningDelta = readString(chunk.additional_kwargs, 'reasoning_content');

          if (reasoningDelta !== undefined) {
            reasoning += reasoningDelta;
            yield { delta: reasoningDelta, type: 'reasoning' };
          }

          if (chunk.text.length > 0) {
            text += chunk.text;
            yield { delta: chunk.text, type: 'content' };
          }

          const chunkUsage = mapUsage(chunk.usage_metadata);

          if (chunkUsage !== undefined && usage === undefined) {
            usage = chunkUsage;
            yield { type: 'usage', usage: chunkUsage };
          }

          const chunkFinishReason = mapFinishReason(
            readString(chunk.response_metadata, 'finish_reason'),
          );

          if (chunkFinishReason !== 'unknown') {
            finishReason = chunkFinishReason;
          }
        }

        if (call.timedOut()) {
          throw new LlmError('LLM_TIMEOUT');
        }

        if (call.userAborted()) {
          throw new LlmError('LLM_ABORTED');
        }

        const result: LlmGenerationResult = {
          finishReason,
          model,
          ...(reasoning.length > 0 ? { reasoning } : {}),
          text,
          ...(usage !== undefined ? { usage } : {}),
        };

        assertTextResult(result);
        completed = true;
        yield { result, type: 'done' };
      } catch (error) {
        if (call.timedOut()) {
          throw new LlmError('LLM_TIMEOUT');
        }

        if (call.userAborted()) {
          throw new LlmError('LLM_ABORTED');
        }

        throw mapLlmError(error, { finishReason });
      } finally {
        if (!completed) {
          call.abort();
        }

        call.cleanup();
      }
    },
  };
}

export function createDeepSeekProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();

  if (!apiKey) {
    throw new LlmError('LLM_CONFIG_MISSING_API_KEY');
  }

  const baseURL = env.DEEPSEEK_BASE_URL?.trim();
  const model = env.DEEPSEEK_MODEL?.trim();

  return createDeepSeekProvider({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
  });
}
