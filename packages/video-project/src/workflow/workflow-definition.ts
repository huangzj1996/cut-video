import { z } from 'zod';

/**
 * 十节点创作流水线的稳定契约。
 *
 * 节点 ID 与用户可见阶段属于产品数据契约，放在 video-project；
 * video-agent 的运行时只消费这些常量，避免 UI / 运行时各维护一份。
 */
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

export const WorkflowNodeIdSchema = z.enum(WORKFLOW_NODE_IDS);

export type WorkflowNodeId = z.infer<typeof WorkflowNodeIdSchema>;

export const WORKFLOW_PHASE_IDS = ['prepare', 'storyboard', 'voice', 'video'] as const;

export const WorkflowPhaseIdSchema = z.enum(WORKFLOW_PHASE_IDS);

export type WorkflowPhaseId = z.infer<typeof WorkflowPhaseIdSchema>;

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

export function getPhaseIdForNode(nodeId: WorkflowNodeId): WorkflowPhaseId | undefined {
  return getPhaseForNode(nodeId)?.id;
}
