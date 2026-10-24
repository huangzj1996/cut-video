import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';
import { ScriptAnalysisDraftSchema } from '../script-analysis';
import { WorkflowNodeIdSchema } from '../workflow/workflow-definition';

export const CHAT_STREAM_SCHEMA_VERSION = '1.0.0' as const;

/**
 * 流式渲染事件：只通过 IPC 推送，不写入 messages.json / events.jsonl。
 *
 * `draft` 是当前时刻的完整快照而不是 delta，前端直接替换即可；
 * `attempt` 变化表示模型重试，前端应清空上一轮内容。
 */
export const ChatStreamEventSchema = z.strictObject({
  schemaVersion: z.literal(CHAT_STREAM_SCHEMA_VERSION),
  projectId: IdSchema,
  runId: IdSchema,
  nodeId: WorkflowNodeIdSchema,
  streamId: z.string().trim().min(1).max(200),
  attempt: z.number().int().positive(),
  draft: ScriptAnalysisDraftSchema,
  done: z.boolean(),
  timestamp: IsoDateSchema,
});

export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
