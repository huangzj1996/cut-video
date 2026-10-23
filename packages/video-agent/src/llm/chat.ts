import { LlmError } from './errors';
import type { LlmGenerationOptions, LlmGenerationResult, LlmMessage, LlmProvider } from './types';

export interface BasicChatOptions extends LlmGenerationOptions {
  readonly system?: string;
}

/**
 * 基础对话调用：把单个用户输入（或完整消息历史）交给 Provider。
 *
 * 不包含结构化输出、工具调用或重试策略；这些由后续工作流层负责。
 */
export async function chat(
  provider: LlmProvider,
  input: string | readonly LlmMessage[],
  options: BasicChatOptions = {},
): Promise<LlmGenerationResult> {
  const { system, ...generationOptions } = options;
  const systemMessages: LlmMessage[] =
    system && system.trim().length > 0 ? [{ content: system, role: 'system' }] : [];
  const messages: LlmMessage[] =
    typeof input === 'string'
      ? [...systemMessages, { content: input, role: 'user' }]
      : [...systemMessages, ...input];

  if (messages.length === 0) {
    throw new LlmError('LLM_INVALID_REQUEST', undefined, false, { field: 'messages' });
  }

  return provider.generate(messages, generationOptions);
}
