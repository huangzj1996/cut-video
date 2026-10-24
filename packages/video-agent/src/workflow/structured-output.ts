import type { z } from 'zod';
import { getJsonSchema } from '@miaoma/video-project';
import { LlmError } from '../llm/errors';
import type { LlmMessage, LlmProvider, LlmUsage } from '../llm/types';
import { WorkflowError } from './errors';

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_REPAIR_TEXT = 4_000;

export interface GenerateStructuredOptions<T> {
  provider: LlmProvider;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  maxAttempts?: number;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  includeJsonSchema?: boolean;
}

export interface StructuredGenerationResult<T> {
  data: T;
  attempts: number;
  model: string;
  usage?: LlmUsage;
}

export class StructuredOutputError extends WorkflowError {
  constructor(
    readonly fieldPaths: string[],
    readonly attempts: number,
    message = '模型输出未通过 Schema 校验。',
  ) {
    super('WORKFLOW_OUTPUT_INVALID', message, false, { fieldPaths, attempts });
    this.name = 'StructuredOutputError';
  }
}

/**
 * 从模型文本中提取 JSON：
 * - 先尝试整段解析；
 * - 再忽略代码围栏/前后说明，按括号配对找第一个完整 JSON 对象或数组；
 * - 字符串内的括号与转义不参与配对。
 */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // 继续尝试从说明文字中提取。
  }

  const start = trimmed.search(/[{[]/);

  if (start < 0) {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      const open = stack.pop();

      if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) {
        return null;
      }

      if (stack.length === 0) {
        const candidate = trimmed.slice(start, index + 1);

        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function fieldPaths(schema: z.ZodError): string[] {
  return schema.issues.map((issue) => issue.path.join('.') || '(root)');
}

function isResponseFormatRejected(error: unknown): boolean {
  if (!(error instanceof LlmError)) {
    return false;
  }

  return (
    error.code === 'LLM_INVALID_REQUEST' &&
    /response_format|json.?mode|json.?object/i.test(error.message)
  );
}

function retryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof LlmError && error.details?.retryAfterMs !== undefined) {
    return Math.min(error.details.retryAfterMs, 10_000);
  }

  return Math.min(250 * 2 ** (attempt - 1), 4_000);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * JSON mode + 本地 Zod 校验 + 字段路径修复。
 *
 * 网络重试与 Schema 修复共享同一个 maxAttempts 预算（默认 3，含首次）。
 * provider 不支持 response_format 时，降级为仅提示词约束，仍共用预算。
 */
export async function generateStructured<T>(
  options: GenerateStructuredOptions<T>,
): Promise<StructuredGenerationResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const schemaText = JSON.stringify(getJsonSchema(options.schema));
  const system =
    options.includeJsonSchema === false
      ? options.system
      : `${options.system}\n\n## JSON Schema\n输出必须符合以下 JSON Schema：\n${schemaText}`;

  let messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: options.user },
  ];
  let useJsonMode = true;
  let lastFieldPaths: string[] = [];
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastAttempt = attempt;

    try {
      const result = await options.provider.generate(messages, {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        ...(useJsonMode ? { responseFormat: 'json_object' } : {}),
      });
      const candidate = extractJsonObject(result.text);

      if (!candidate) {
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: result.text.slice(0, MAX_REPAIR_TEXT),
          },
          {
            role: 'user',
            content:
              '上次输出没有包含可解析的 JSON 对象。请只返回一个完整的 JSON 对象，不要代码围栏或解释。',
          },
        ];
        continue;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(candidate);
      } catch {
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: candidate.slice(0, MAX_REPAIR_TEXT),
          },
          {
            role: 'user',
            content: '上次输出不是合法 JSON。请修正语法后只返回完整的 JSON 对象。',
          },
        ];
        continue;
      }

      const validated = options.schema.safeParse(parsed);

      if (validated.success) {
        return {
          data: validated.data,
          attempts: attempt,
          model: result.model,
          ...(result.usage !== undefined ? { usage: result.usage } : {}),
        };
      }

      lastFieldPaths = fieldPaths(validated.error);
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: candidate.slice(0, MAX_REPAIR_TEXT),
        },
        {
          role: 'user',
          content: [
            '上次输出未通过 Schema 校验。',
            `字段路径与原因：${validated.error.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; ')}`,
            '请只返回修正后的完整 JSON 对象，保留所有必填字段。',
          ].join('\n'),
        },
      ];
    } catch (error) {
      if (useJsonMode && isResponseFormatRejected(error)) {
        useJsonMode = false;
        continue;
      }

      if (error instanceof LlmError && error.retryable) {
        if (attempt >= maxAttempts) {
          throw error;
        }

        await sleep(retryDelayMs(error, attempt), options.signal);
        continue;
      }

      throw error;
    }
  }

  throw new StructuredOutputError(lastFieldPaths, lastAttempt);
}
