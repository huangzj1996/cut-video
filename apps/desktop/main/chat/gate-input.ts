import type { ApprovalDecision } from '@miaoma/video-project';
import { IpcError } from '../ipc-error';

const APPROVAL_PHRASES = new Set([
  '确认',
  '确认并继续',
  '确认继续',
  '可以',
  '同意',
  '通过',
  '没问题',
  '就这样',
  '继续',
]);

/**
 * 归一化：去首尾空白和标点、压缩空白、统一全角。
 * 只有明确白名单才视为确认；其余文本一律走修改分支，绝不静默确认。
 */
const EDGE_PUNCTUATION =
  /^[\s"'“”‘’「」『』（）()【】[\]，,。.!！?？；;：:、]+|[\s"'“”‘’「」『』（）()【】[\]，,。.!！?？；;：:、]+$/gu;

export function normalizeGateText(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(EDGE_PUNCTUATION, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function classifyGateInput(text: string): ApprovalDecision {
  const rawText = text.trim();

  if (!rawText) {
    throw new IpcError('CHAT_INVALID_ARGUMENT', '请输入审批回复。');
  }

  if (APPROVAL_PHRASES.has(normalizeGateText(rawText))) {
    return { decision: 'approve', rawText };
  }

  return {
    decision: 'request_changes',
    feedback: rawText,
    rawText,
  };
}
