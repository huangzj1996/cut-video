import { describe, expect, it } from 'vitest';
import { LlmError, mapLlmError, toLlmErrorSummary } from './errors';

function httpError(
  status: number,
  message = 'provider failure',
  extra: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(message), { status, ...extra });
}

describe('mapLlmError', () => {
  it('maps authentication, balance, permission, and model errors', () => {
    expect(mapLlmError(httpError(401)).code).toBe('LLM_AUTHENTICATION');
    expect(mapLlmError(httpError(402)).code).toBe('LLM_INSUFFICIENT_BALANCE');
    expect(mapLlmError(httpError(403)).code).toBe('LLM_PERMISSION_DENIED');
    expect(mapLlmError(httpError(404)).code).toBe('LLM_MODEL_NOT_FOUND');
    expect(
      mapLlmError(httpError(401, 'bad key', { lc_error_code: 'MODEL_AUTHENTICATION' })).code,
    ).toBe('LLM_AUTHENTICATION');
  });

  it('maps context overflow and generic 400/422 errors', () => {
    expect(mapLlmError(httpError(400, 'maximum context length exceeded'))).toMatchObject({
      code: 'LLM_CONTEXT_OVERFLOW',
    });
    expect(mapLlmError(httpError(422, 'invalid params'))).toMatchObject({
      code: 'LLM_INVALID_REQUEST',
      retryable: false,
    });
  });

  it('maps rate limits with Retry-After and server errors as retryable', () => {
    const rateLimited = httpError(429, 'slow down', {
      headers: new Headers({ 'retry-after': '3' }),
      lc_error_code: 'MODEL_RATE_LIMIT',
    });
    const server = httpError(503, 'overloaded');

    expect(mapLlmError(rateLimited)).toMatchObject({
      code: 'LLM_RATE_LIMIT',
      retryable: true,
      details: { retryAfterMs: 3_000, status: 429 },
    });
    expect(mapLlmError(server)).toMatchObject({
      code: 'LLM_SERVER_ERROR',
      retryable: true,
      details: { status: 503 },
    });
  });

  it('parses Retry-After HTTP dates', () => {
    const retryAt = new Date(Date.now() + 5_000).toUTCString();
    const error = httpError(429, 'slow down', {
      headers: new Headers({ 'retry-after': retryAt }),
    });
    const mapped = mapLlmError(error);

    expect(mapped.code).toBe('LLM_RATE_LIMIT');
    expect(mapped.details?.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(mapped.details?.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it('maps timeout, abort, and network failures', () => {
    expect(
      mapLlmError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
    ).toMatchObject({
      code: 'LLM_TIMEOUT',
      retryable: true,
    });
    expect(mapLlmError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toMatchObject({
      code: 'LLM_ABORTED',
      retryable: false,
    });
    expect(
      mapLlmError(Object.assign(new Error('fetch failed'), { name: 'APIConnectionError' })),
    ).toMatchObject({ code: 'LLM_NETWORK_ERROR', retryable: true });
    expect(
      mapLlmError(Object.assign(new Error('socket'), { cause: { code: 'ECONNRESET' } })),
    ).toMatchObject({ code: 'LLM_NETWORK_ERROR', retryable: true });
  });

  it('prioritizes timeout and abort context over nested errors', () => {
    expect(mapLlmError(new LlmError('LLM_EMPTY_RESPONSE'), { timedOut: true }).code).toBe(
      'LLM_TIMEOUT',
    );
    expect(mapLlmError(new LlmError('LLM_EMPTY_RESPONSE'), { aborted: true }).code).toBe(
      'LLM_ABORTED',
    );
  });

  it('falls back to LLM_UNKNOWN without leaking the original message', () => {
    const secret = 'sk-test-secret prompt /secret/path';
    const mapped = mapLlmError(new Error(secret));

    expect(mapped.code).toBe('LLM_UNKNOWN');
    expect(mapped.message).not.toContain('sk-test-secret');
    expect(mapped.message).not.toContain('/secret/path');
    expect(JSON.stringify(mapped)).not.toContain('sk-test-secret');
  });
});

describe('toLlmErrorSummary', () => {
  it('returns safe summaries for known errors', () => {
    const summary = toLlmErrorSummary(
      new LlmError('LLM_OUTPUT_TRUNCATED', undefined, false, { finishReason: 'length' }),
    );

    expect(summary).toMatchObject({
      code: 'LLM_OUTPUT_TRUNCATED',
      message: '模型输出被截断，请增大输出上限。',
      retryable: false,
      details: { finishReason: 'length' },
    });
  });

  it('maps unknown values to LLM_UNKNOWN without copying messages', () => {
    const summary = toLlmErrorSummary(new Error('sk-test-secret'));

    expect(summary).toEqual({
      code: 'LLM_UNKNOWN',
      message: '模型调用失败。',
      retryable: false,
    });
    expect(JSON.stringify(summary)).not.toContain('sk-test-secret');
  });
});
