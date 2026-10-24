export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string;
}

export type LlmFinishReason = 'stop' | 'length' | 'content_filter' | 'unknown';

export interface LlmUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
}

export interface LlmGenerationOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly stop?: readonly string[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * 请求 provider 返回 JSON 对象（OpenAI 兼容的 response_format）。
   * 不支持时调用方负责降级为仅提示词约束。
   */
  readonly responseFormat?: 'json_object';
}

export interface LlmGenerationResult {
  readonly text: string;
  readonly reasoning?: string;
  readonly model: string;
  readonly finishReason: LlmFinishReason;
  readonly usage?: LlmUsage;
}

export type LlmStreamEvent =
  | { readonly type: 'reasoning'; readonly delta: string }
  | { readonly type: 'content'; readonly delta: string }
  | { readonly type: 'usage'; readonly usage: LlmUsage }
  | { readonly type: 'done'; readonly result: LlmGenerationResult };

export interface LlmProviderCapabilities {
  readonly provider: string;
  readonly model: string;
  readonly streaming: boolean;
  readonly reasoning: boolean;
}

export interface LlmProvider {
  readonly id: string;
  readonly defaultModel: string;
  getCapabilities(model?: string): LlmProviderCapabilities;
  generate(
    messages: readonly LlmMessage[],
    options?: LlmGenerationOptions,
  ): Promise<LlmGenerationResult>;
  stream(
    messages: readonly LlmMessage[],
    options?: LlmGenerationOptions,
  ): AsyncGenerator<LlmStreamEvent, void, void>;
}
