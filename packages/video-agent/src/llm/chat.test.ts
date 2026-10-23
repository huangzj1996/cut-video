import { describe, expect, it, vi } from 'vitest';
import { chat } from './chat';
import { LlmError } from './errors';
import type { LlmGenerationResult, LlmProvider } from './types';

const RESULT: LlmGenerationResult = {
  finishReason: 'stop',
  model: 'deepseek-chat',
  text: '你好，我是妙剪。',
};

function fakeProvider(generate: LlmProvider['generate'] = async () => RESULT): LlmProvider {
  return {
    defaultModel: 'deepseek-chat',
    generate,
    getCapabilities: () => ({
      model: 'deepseek-chat',
      provider: 'deepseek',
      reasoning: false,
      streaming: true,
    }),
    id: 'deepseek',
    // 基础对话不消费流式接口；保留一个空实现满足 Provider 契约。
    stream: async function* stream() {},
  };
}

describe('chat', () => {
  it('builds a system + user conversation from a string input', async () => {
    const generate = vi.fn(async () => RESULT);
    const provider = fakeProvider(generate);

    const result = await chat(provider, '你好', { system: '你是助手。', temperature: 0.2 });

    expect(result).toEqual(RESULT);
    expect(generate).toHaveBeenCalledWith(
      [
        { content: '你是助手。', role: 'system' },
        { content: '你好', role: 'user' },
      ],
      { temperature: 0.2 },
    );
  });

  it('passes a full message history through unchanged', async () => {
    const generate = vi.fn(async () => RESULT);
    const provider = fakeProvider(generate);
    const messages = [
      { content: '你好', role: 'user' as const },
      { content: '你好！', role: 'assistant' as const },
      { content: '继续', role: 'user' as const },
    ];

    await chat(provider, messages);

    expect(generate).toHaveBeenCalledWith(messages, {});
  });

  it('propagates provider errors unchanged', async () => {
    const error = new LlmError('LLM_AUTHENTICATION');
    const provider = fakeProvider(async () => {
      throw error;
    });

    await expect(chat(provider, '你好')).rejects.toBe(error);
  });

  it('rejects an empty message history', async () => {
    const provider = fakeProvider();

    await expect(chat(provider, [])).rejects.toMatchObject({
      code: 'LLM_INVALID_REQUEST',
      details: { field: 'messages' },
    });
  });
});
