// LLM 能力故意不从根 barrel 导出；请从 `@miaoma/video-agent/llm` 引入，
// 避免主进程 bundle 意外带上 LangChain。
export * from './media/keyframe-extractor';
export * from './media/media-error';
export * from './media/video-probe';

export {
  WORKFLOW_NODE_IDS,
  WORKFLOW_PHASES,
  createWorkflowDefinition,
  getPhaseForNode,
  getPhaseIdForNode,
  WorkflowNodeIdSchema,
  WorkflowPhaseIdSchema,
} from '@miaoma/video-project';

export type {
  WorkflowDefinition,
  WorkflowNodeId,
  WorkflowPhaseDefinition,
  WorkflowPhaseId,
} from '@miaoma/video-project';
