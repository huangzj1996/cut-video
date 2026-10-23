export * from './media/keyframe-extractor';
export * from './media/media-error';
export * from './media/video-probe';

export const WORKFLOW_NODE_IDS = [
  'scan_assets',
  'analyze_assets',
  'creative_brief',
  'plan_scenes',
  'scene_approval',
  'synthesize_voice',
  'match_assets',
  'assemble_timeline',
  'validate_project',
  'save_project',
] as const;

export type WorkflowNodeId = (typeof WORKFLOW_NODE_IDS)[number];

export type WorkflowPhaseId = 'prepare' | 'storyboard' | 'voice' | 'video';

export interface WorkflowPhaseDefinition {
  id: WorkflowPhaseId;
  label: string;
  nodeIds: readonly WorkflowNodeId[];
}

export const WORKFLOW_PHASES: readonly WorkflowPhaseDefinition[] = [
  {
    id: 'prepare',
    label: '01 准备',
    nodeIds: ['scan_assets', 'analyze_assets', 'creative_brief'],
  },
  {
    id: 'storyboard',
    label: '02 创建分镜',
    nodeIds: ['plan_scenes', 'scene_approval'],
  },
  {
    id: 'voice',
    label: '03 配音生成',
    nodeIds: ['synthesize_voice'],
  },
  {
    id: 'video',
    label: '04 视频生成',
    nodeIds: ['match_assets', 'assemble_timeline', 'validate_project', 'save_project'],
  },
];

export interface WorkflowDefinition {
  id: string;
  nodeIds: readonly WorkflowNodeId[];
  phases: readonly WorkflowPhaseDefinition[];
}

/**
 * T01 只提供稳定的节点/阶段契约。T02/T07 会用 LangGraph StateGraph 实现运行时。
 */
export function createWorkflowDefinition(): WorkflowDefinition {
  return {
    id: 'miaoma.magicut.workflow.v1',
    nodeIds: WORKFLOW_NODE_IDS,
    phases: WORKFLOW_PHASES,
  };
}

export function getPhaseForNode(nodeId: WorkflowNodeId): WorkflowPhaseDefinition | undefined {
  return WORKFLOW_PHASES.find((phase) => phase.nodeIds.includes(nodeId));
}
