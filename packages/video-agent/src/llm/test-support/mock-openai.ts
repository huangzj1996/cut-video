export interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export interface MockOpenAI {
  readonly fetch: typeof fetch;
  readonly requests: CapturedRequest[];
}

export function createMockOpenAI(
  handler: (request: CapturedRequest, index: number) => Response | Promise<Response>,
): MockOpenAI {
  const requests: CapturedRequest[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rawBody = init?.body;
    const body =
      typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const request: CapturedRequest = {
      body,
      headers: new Headers(init?.headers),
      method: init?.method ?? 'POST',
      url,
      ...(init?.signal ? { signal: init.signal } : {}),
    };

    requests.push(request);
    return handler(request, requests.length - 1);
  };

  return { fetch: fetchImpl, requests };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
    status,
  });
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export function tokenUsage(input = 10, output = 5): TokenUsage {
  return {
    completion_tokens: output,
    prompt_tokens: input,
    total_tokens: input + output,
  };
}

export interface OpenAiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ChatCompletionOptions {
  readonly content?: string;
  readonly finishReason?: string;
  readonly invalidToolCalls?: readonly OpenAiToolCall[];
  readonly model?: string;
  readonly reasoningContent?: string;
  readonly toolCalls?: readonly OpenAiToolCall[];
  readonly usage?: TokenUsage;
}

export function chatCompletion(options: ChatCompletionOptions = {}): Record<string, unknown> {
  const message: Record<string, unknown> = {
    content: options.content ?? '',
    role: 'assistant',
  };

  if (options.reasoningContent !== undefined) {
    message.reasoning_content = options.reasoningContent;
  }

  if (options.toolCalls !== undefined) {
    message.tool_calls = options.toolCalls.map((call) => ({
      function: { arguments: call.arguments, name: call.name },
      id: call.id,
      type: 'function',
    }));
  }

  if (options.invalidToolCalls !== undefined) {
    message.tool_calls = options.invalidToolCalls.map((call) => ({
      function: { arguments: call.arguments, name: call.name },
      id: call.id,
      type: 'function',
    }));
  }

  return {
    choices: [
      {
        finish_reason: options.finishReason ?? 'stop',
        index: 0,
        message,
      },
    ],
    created: 1,
    id: 'chatcmpl-test',
    model: options.model ?? 'deepseek-chat',
    object: 'chat.completion',
    ...(options.usage ? { usage: options.usage } : {}),
  };
}

export interface SseChunkOptions {
  readonly content?: string;
  readonly finishReason?: string;
  readonly model?: string;
  readonly reasoningContent?: string;
  readonly usage?: TokenUsage;
}

export function sseChunk(options: SseChunkOptions = {}): Record<string, unknown> {
  return {
    choices: [
      {
        delta: {
          role: 'assistant',
          ...(options.content !== undefined ? { content: options.content } : {}),
          ...(options.reasoningContent !== undefined
            ? { reasoning_content: options.reasoningContent }
            : {}),
        },
        finish_reason: options.finishReason ?? null,
        index: 0,
      },
    ],
    created: 1,
    id: 'chatcmpl-test',
    model: options.model ?? 'deepseek-chat',
    object: 'chat.completion.chunk',
    ...(options.usage ? { usage: options.usage } : {}),
  };
}

export function usageChunk(usage: TokenUsage, model = 'deepseek-chat'): Record<string, unknown> {
  return {
    choices: [],
    created: 1,
    id: 'chatcmpl-test',
    model,
    object: 'chat.completion.chunk',
    usage,
  };
}

export interface SseResponseOptions {
  readonly keepAlive?: boolean;
  readonly splitSize?: number;
}

export function sseResponse(
  events: readonly (Record<string, unknown> | '[DONE]')[],
  options: SseResponseOptions = {},
): Response {
  const parts: string[] = [];

  if (options.keepAlive) {
    parts.push(': keep-alive\n\n', '\n');
  }

  for (const event of events) {
    parts.push(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
  }

  const bytes = new TextEncoder().encode(parts.join(''));
  const splitSize = options.splitSize ?? bytes.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += splitSize) {
        controller.enqueue(bytes.slice(offset, offset + splitSize));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream' },
    status: 200,
  });
}

export function openAiErrorBody(
  message: string,
  type = 'api_error',
  code?: string,
): Record<string, unknown> {
  return {
    error: {
      code: code ?? null,
      message,
      type,
    },
  };
}
