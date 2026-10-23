import type { LlmFinishReason } from './types';

export type LlmErrorCode =
  | 'LLM_CONFIG_MISSING_API_KEY'
  | 'LLM_CONFIG_INVALID'
  | 'LLM_INVALID_REQUEST'
  | 'LLM_AUTHENTICATION'
  | 'LLM_PERMISSION_DENIED'
  | 'LLM_INSUFFICIENT_BALANCE'
  | 'LLM_MODEL_NOT_FOUND'
  | 'LLM_CONTEXT_OVERFLOW'
  | 'LLM_RATE_LIMIT'
  | 'LLM_SERVER_ERROR'
  | 'LLM_NETWORK_ERROR'
  | 'LLM_TIMEOUT'
  | 'LLM_ABORTED'
  | 'LLM_EMPTY_RESPONSE'
  | 'LLM_OUTPUT_TRUNCATED'
  | 'LLM_CONTENT_FILTERED'
  | 'LLM_UNKNOWN';

export interface LlmErrorDetails {
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly field?: string;
  readonly finishReason?: LlmFinishReason;
}

const ERROR_MESSAGES: Record<LlmErrorCode, string> = {
  LLM_CONFIG_MISSING_API_KEY: '未配置 DeepSeek API Key。',
  LLM_CONFIG_INVALID: '模型配置无效。',
  LLM_INVALID_REQUEST: '模型请求参数无效。',
  LLM_AUTHENTICATION: '模型密钥无效或已过期。',
  LLM_PERMISSION_DENIED: '当前 API Key 没有访问该模型的权限。',
  LLM_INSUFFICIENT_BALANCE: '模型账户余额不足。',
  LLM_MODEL_NOT_FOUND: '未找到指定模型。',
  LLM_CONTEXT_OVERFLOW: '对话内容超出模型上下文上限。',
  LLM_RATE_LIMIT: '模型请求过于频繁，请稍后重试。',
  LLM_SERVER_ERROR: '模型服务暂时不可用，请稍后重试。',
  LLM_NETWORK_ERROR: '无法连接模型服务，请检查网络。',
  LLM_TIMEOUT: '模型响应超时。',
  LLM_ABORTED: '模型请求已取消。',
  LLM_EMPTY_RESPONSE: '模型没有返回内容。',
  LLM_OUTPUT_TRUNCATED: '模型输出被截断，请增大输出上限。',
  LLM_CONTENT_FILTERED: '模型输出被安全策略拦截。',
  LLM_UNKNOWN: '模型调用失败。',
};

const RETRYABLE_CODES = new Set<LlmErrorCode>([
  'LLM_RATE_LIMIT',
  'LLM_SERVER_ERROR',
  'LLM_NETWORK_ERROR',
  'LLM_TIMEOUT',
  'LLM_EMPTY_RESPONSE',
]);

const CONTEXT_OVERFLOW_PATTERN =
  /context[_ ]length|maximum context|exceeds the context window|input tokens exceed|too many tokens/i;
const NETWORK_CAUSE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;
  readonly details?: LlmErrorDetails;

  constructor(
    code: LlmErrorCode,
    message: string = ERROR_MESSAGES[code],
    retryable: boolean = RETRYABLE_CODES.has(code),
    details?: LlmErrorDetails,
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface LlmErrorSummary {
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: LlmErrorDetails;
}

export interface MapLlmErrorContext {
  readonly timedOut?: boolean;
  readonly aborted?: boolean;
  readonly finishReason?: LlmFinishReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function readNestedNumber(value: unknown, key: string, nestedKey: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return readNumber(value[key], nestedKey);
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return readString(error, 'name');
}

function getConstructorName(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const constructor = error.constructor;
  return typeof constructor === 'function' ? constructor.name : undefined;
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function getLanguageChainCode(error: unknown): string | undefined {
  return readString(error, 'lc_error_code');
}

function getStatus(error: unknown): number | undefined {
  return readNumber(error, 'status') ?? readNestedNumber(error, 'response', 'status');
}

function getCauseCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return readString(error.cause, 'code');
}

function getHeader(error: unknown, name: string): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const headers = error.headers;

  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  if (isRecord(headers)) {
    const direct = headers[name] ?? headers[name.toLowerCase()];
    return typeof direct === 'string' ? direct : undefined;
  }

  return undefined;
}

function parseRetryAfterMs(error: unknown): number | undefined {
  const raw = getHeader(error, 'retry-after');

  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const date = Date.parse(raw);

  if (!Number.isFinite(date)) {
    return undefined;
  }

  return Math.max(0, date - Date.now());
}

function makeError(
  code: LlmErrorCode,
  status?: number,
  extras: Partial<LlmErrorDetails> = {},
): LlmError {
  const details: LlmErrorDetails = {
    ...(status !== undefined ? { status } : {}),
    ...extras,
  };

  return new LlmError(
    code,
    ERROR_MESSAGES[code],
    RETRYABLE_CODES.has(code),
    Object.keys(details).length > 0 ? details : undefined,
  );
}

function withContext(error: LlmError, context: MapLlmErrorContext): LlmError {
  if (context.finishReason === undefined) {
    return error;
  }

  return new LlmError(error.code, error.message, error.retryable, {
    ...error.details,
    finishReason: context.finishReason,
  });
}

/**
 * 把 SDK/LangChain 异常转换为统一的 LlmError。
 *
 * 只使用原始异常做内部分类，不把 message、响应体或 prompt 放入结果。
 */
export function mapLlmError(error: unknown, context: MapLlmErrorContext = {}): LlmError {
  if (context.timedOut) {
    return makeError('LLM_TIMEOUT');
  }

  if (context.aborted) {
    return makeError('LLM_ABORTED');
  }

  if (error instanceof LlmError) {
    return withContext(error, context);
  }

  const name = getErrorName(error);
  const constructorName = getConstructorName(error);
  const status = getStatus(error);
  const lcCode = getLanguageChainCode(error);

  if (
    name === 'TimeoutError' ||
    constructorName === 'APIConnectionTimeoutError' ||
    status === 408
  ) {
    return makeError('LLM_TIMEOUT', status);
  }

  if (name === 'AbortError' || name === 'ModelAbortError') {
    return makeError('LLM_ABORTED');
  }

  if (name === 'ContextOverflowError' || lcCode === 'MODEL_CONTEXT_LENGTH') {
    return makeError('LLM_CONTEXT_OVERFLOW', status);
  }

  if (lcCode === 'MODEL_AUTHENTICATION' || status === 401) {
    return makeError('LLM_AUTHENTICATION', status);
  }

  if (lcCode === 'MODEL_RATE_LIMIT' || status === 429) {
    const retryAfterMs = parseRetryAfterMs(error);
    return makeError('LLM_RATE_LIMIT', status, retryAfterMs !== undefined ? { retryAfterMs } : {});
  }

  if (lcCode === 'MODEL_NOT_FOUND' || status === 404) {
    return makeError('LLM_MODEL_NOT_FOUND', status);
  }

  if (status === 402) {
    return makeError('LLM_INSUFFICIENT_BALANCE', status);
  }

  if (status === 403) {
    return makeError('LLM_PERMISSION_DENIED', status);
  }

  if (status === 400 || status === 422) {
    if (CONTEXT_OVERFLOW_PATTERN.test(getMessage(error))) {
      return makeError('LLM_CONTEXT_OVERFLOW', status);
    }

    return makeError('LLM_INVALID_REQUEST', status);
  }

  if (status !== undefined && status >= 500) {
    return makeError('LLM_SERVER_ERROR', status);
  }

  const causeCode = getCauseCode(error);

  if (
    name === 'APIConnectionError' ||
    (causeCode !== undefined && NETWORK_CAUSE_CODES.has(causeCode)) ||
    /fetch failed|network error|connection error/i.test(getMessage(error))
  ) {
    return makeError('LLM_NETWORK_ERROR', status);
  }

  return makeError('LLM_UNKNOWN', status);
}

/** 只把安全、结构化的错误返回给上层；未知异常统一为 LLM_UNKNOWN。 */
export function toLlmErrorSummary(error: unknown): LlmErrorSummary {
  if (error instanceof LlmError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  return {
    code: 'LLM_UNKNOWN',
    message: ERROR_MESSAGES.LLM_UNKNOWN,
    retryable: false,
  };
}
