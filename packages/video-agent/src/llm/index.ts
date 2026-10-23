/**
 * LLM Provider 公共入口。
 *
 * 只通过 `@miaoma/video-agent/llm` 子路径暴露，避免 Electron 主进程
 * 从包根导入媒体能力时把 LangChain 一并打入 bundle。
 */
export type {
  LlmFinishReason,
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider,
  LlmProviderCapabilities,
  LlmRole,
  LlmStreamEvent,
  LlmUsage,
} from './types';

export type { LlmErrorCode, LlmErrorDetails, LlmErrorSummary } from './errors';
export { LlmError, toLlmErrorSummary } from './errors';

export type { BasicChatOptions } from './chat';
export { chat } from './chat';

export type { DeepSeekProviderConfig } from './deepseek';
export {
  createDeepSeekProvider,
  createDeepSeekProviderFromEnv,
  DEEPSEEK_DEFAULTS,
  getDeepSeekCapabilities,
} from './deepseek';
