import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { LlmMessage } from './types';

/** 把自有消息转换为 LangChain 消息。 */
export function toLangChainMessages(messages: readonly LlmMessage[]): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case 'system':
        return new SystemMessage(message.content);
      case 'assistant':
        return new AIMessage(message.content);
      case 'user':
        return new HumanMessage(message.content);
    }
  });
}
