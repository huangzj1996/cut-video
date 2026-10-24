import {
  EMPTY_SCRIPT_ANALYSIS_SECTIONS,
  ScriptAnalysisContentSchema,
  type ScriptAnalysisContent,
  type ScriptAnalysisSectionsDraft,
} from '@miaoma/video-project';
import { LlmError } from '../llm/errors';
import type { LlmGenerationResult, LlmMessage, LlmProvider, LlmUsage } from '../llm/types';
import { StructuredOutputError } from './structured-output';
import { WorkflowError } from './errors';

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_REPAIR_TEXT = 4_000;
const DEFAULT_PARTIAL_INTERVAL_MS = 80;

const SECTION_MARKERS = [
  ['intro', '<<<INTRO>>>'],
  ['structureIntro', '<<<STRUCTURE>>>'],
  ['scriptType', '<<<SCRIPT_TYPE>>>'],
  ['voiceoverScript', '<<<VOICEOVER>>>'],
  ['schemeRecommendation', '<<<SCHEME>>>'],
] as const;

/**
 * 从流式文本中提取五段分析。
 *
 * 输入可能是半截内容：缺少的段落返回空字符串，尚未接收完整的结尾标记
 * （例如 `<<<STR`）会从上一段末尾去掉，避免闪烁出标记碎片。
 */
export function parseScriptAnalysisSections(raw: string): ScriptAnalysisSectionsDraft {
  const text = raw.replace(/\r\n?/g, '\n');
  const found = SECTION_MARKERS.map(([key, marker]) => ({
    key,
    marker,
    index: text.indexOf(marker),
  }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);
  const sections: ScriptAnalysisSectionsDraft = { ...EMPTY_SCRIPT_ANALYSIS_SECTIONS };

  for (let position = 0; position < found.length; position += 1) {
    const current = found[position]!;
    const next = found[position + 1];
    const start = current.index + current.marker.length;
    const end = next?.index ?? text.length;
    let content = text.slice(start, end);

    content = content
      .replace(/^```[a-zA-Z]*\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .replace(/<{1,3}[A-Z_]*\s*$/, '');

    sections[current.key] = content.trim();
  }

  return sections;
}

export interface ScriptAnalysisStreamOptions {
  provider: LlmProvider;
  system: string;
  user: string;
  maxAttempts?: number;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  partialIntervalMs?: number;
  /** 每次收到可解析的增量文本时回调；同一 attempt 内为最新快照。 */
  onPartial?: (draft: ScriptAnalysisSectionsDraft, attempt: number) => void;
}

export interface ScriptAnalysisStreamResult {
  attempts: number;
  content: ScriptAnalysisContent;
  model: string;
  usage?: LlmUsage;
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

function missingSections(issues: { path: PropertyKey[] }[]): string[] {
  return [...new Set(issues.map((issue) => String(issue.path[0] ?? '(root)')))];
}

/**
 * 使用 provider.stream() 生成文稿分析。
 *
 * 输出是带固定标记的纯文本，五段可以在生成过程中逐步解析并上报；
 * 完成后用 Zod 校验，缺少段落时带着字段名重试（默认最多 3 次）。
 */
export async function generateScriptAnalysisStreaming(
  options: ScriptAnalysisStreamOptions,
): Promise<ScriptAnalysisStreamResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const partialIntervalMs = options.partialIntervalMs ?? DEFAULT_PARTIAL_INTERVAL_MS;
  let messages: LlmMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ];
  let lastFieldPaths: string[] = [];
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastAttempt = attempt;
    let lastEmit = 0;
    let text = '';
    let result: LlmGenerationResult | undefined;

    const emit = (force = false): void => {
      const now = Date.now();

      if (!force && now - lastEmit < partialIntervalMs) {
        return;
      }

      lastEmit = now;
      options.onPartial?.(parseScriptAnalysisSections(text), attempt);
    };

    emit(true);

    try {
      for await (const event of options.provider.stream(messages, {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      })) {
        if (event.type === 'content') {
          text += event.delta;
          emit();
        } else if (event.type === 'done') {
          result = event.result;
        }
      }

      if (!result) {
        throw new WorkflowError('WORKFLOW_OUTPUT_INVALID', '文稿分析流式输出未正常结束。');
      }

      const sections = parseScriptAnalysisSections(text);
      const parsed = ScriptAnalysisContentSchema.safeParse(sections);

      if (parsed.success) {
        options.onPartial?.(parsed.data, attempt);
        return {
          attempts: attempt,
          content: parsed.data,
          model: result.model,
          ...(result.usage !== undefined ? { usage: result.usage } : {}),
        };
      }

      lastFieldPaths = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
      const missing = missingSections(parsed.error.issues).join('、');
      messages = [
        ...messages,
        { role: 'assistant', content: text.slice(0, MAX_REPAIR_TEXT) },
        {
          role: 'user',
          content: [
            `上次输出缺少或不符合以下段落：${missing}。`,
            '请严格按 <<<INTRO>>>、<<<STRUCTURE>>>、<<<SCRIPT_TYPE>>>、<<<VOICEOVER>>>、<<<SCHEME>>> 的顺序重新输出，只输出五段纯文本。',
          ].join('\n'),
        },
      ];
    } catch (error) {
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

  throw new StructuredOutputError(lastFieldPaths, lastAttempt, '文稿分析输出未通过校验。');
}
