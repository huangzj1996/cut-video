import { ZodError } from 'zod';
import { toLlmErrorSummary } from '../llm/errors';

export const WORKFLOW_ERROR_CODES = [
  'WORKFLOW_INPUT_MISSING',
  'WORKFLOW_INPUT_INVALID',
  'WORKFLOW_OUTPUT_INVALID',
  'WORKFLOW_STALE_APPROVAL',
  'WORKFLOW_STALE_RESULT',
  'WORKFLOW_ARTIFACT_INVALID',
  'WORKFLOW_CHECKPOINT_INVALID',
  'WORKFLOW_CHECKPOINT_INCOMPATIBLE',
  'WORKFLOW_STEP_FAILED',
  'WORKFLOW_CANCELLED',
  'WORKFLOW_RECURSION_LIMIT',
  'WORKFLOW_LLM_FAILED',
  'WORKFLOW_VALIDATION_FAILED',
  'WORKFLOW_NOT_FOUND',
  'WORKFLOW_BUSY',
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export interface SafeWorkflowError {
  code: string;
  message: string;
  retryable: boolean;
}

const SAFE_MESSAGES: Record<WorkflowErrorCode, string> = {
  WORKFLOW_INPUT_MISSING: '工作流缺少必要输入。',
  WORKFLOW_INPUT_INVALID: '节点输入不符合 Schema。',
  WORKFLOW_OUTPUT_INVALID: '节点输出不符合 Schema。',
  WORKFLOW_STALE_APPROVAL: '审批已过期，请基于最新版本重新确认。',
  WORKFLOW_STALE_RESULT: '工程内容已被修改，请重新生成。',
  WORKFLOW_ARTIFACT_INVALID: '工作流产物无效或已损坏。',
  WORKFLOW_CHECKPOINT_INVALID: '工作流检查点无效。',
  WORKFLOW_CHECKPOINT_INCOMPATIBLE: '检查点版本与当前应用不兼容。',
  WORKFLOW_STEP_FAILED: '工作流节点执行失败。',
  WORKFLOW_CANCELLED: '工作流已取消。',
  WORKFLOW_RECURSION_LIMIT: '工作流步数超过上限。',
  WORKFLOW_LLM_FAILED: '模型调用失败。',
  WORKFLOW_VALIDATION_FAILED: '工程校验未通过。',
  WORKFLOW_NOT_FOUND: '工作流运行不存在。',
  WORKFLOW_BUSY: '工作流正在执行中。',
};

export function workflowErrorMessage(code: WorkflowErrorCode): string {
  return SAFE_MESSAGES[code];
}

/**
 * 只把安全错误码和文案交给事件 / IPC；原始 message、stack、绝对路径
 * 只留在本地日志，不进入 ChatMessage 或渲染进程。
 */
export function toSafeWorkflowError(error: unknown): SafeWorkflowError {
  if (error instanceof WorkflowError) {
    return {
      code: error.code,
      message: error.message || SAFE_MESSAGES[error.code],
      retryable: error.retryable,
    };
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'WORKFLOW_CANCELLED',
      message: SAFE_MESSAGES.WORKFLOW_CANCELLED,
      retryable: false,
    };
  }

  // 桌面端口抛出的 IpcError 已按“安全错误”设计，保留其码和文案，
  // 让 UI 能看到 ffprobe/ffmpeg/素材路径等可操作提示。
  if (error instanceof Error && error.name === 'IpcError') {
    const details = error as unknown as { code?: unknown; retryable?: unknown };

    if (typeof details.code === 'string') {
      return {
        code: details.code,
        message: error.message,
        retryable: Boolean(details.retryable),
      };
    }
  }

  if (error instanceof ZodError) {
    return {
      code: 'WORKFLOW_OUTPUT_INVALID',
      message: SAFE_MESSAGES.WORKFLOW_OUTPUT_INVALID,
      retryable: false,
    };
  }

  const llm = toLlmErrorSummary(error);

  if (llm.code !== 'LLM_UNKNOWN') {
    return {
      code: 'WORKFLOW_LLM_FAILED',
      message: llm.message,
      retryable: llm.retryable,
    };
  }

  return {
    code: 'WORKFLOW_STEP_FAILED',
    message: SAFE_MESSAGES.WORKFLOW_STEP_FAILED,
    retryable: false,
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
  );
}

export function isRecursionLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'GraphRecursionError' || error.message.includes('recursion limit'))
  );
}
