import type { WorkflowRunStatus } from '@miaoma/video-project';

/**
 * 工作流运行或等待审批时，工程内容由工作流独占。
 * 编辑器只读与导出阻止共用这一条判定，避免两处规则漂移。
 */
export function isWorkflowReadonly(status: WorkflowRunStatus | null): boolean {
  return status === 'running' || status === 'waiting_user';
}
