import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { toLangChainMessages } from './messages';

describe('toLangChainMessages', () => {
  it('maps system, user, and assistant roles', () => {
    const messages = toLangChainMessages([
      { content: 'system prompt', role: 'system' },
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
    ]);

    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[2]).toBeInstanceOf(AIMessage);
    expect(messages.map((message) => message.text)).toEqual(['system prompt', 'hello', 'hi']);
  });
});
