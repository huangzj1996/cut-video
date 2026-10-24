import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import type { WorkflowNodeId } from '@miaoma/video-project';
import type { WorkflowNodeRunner } from './node-wrapper';
import { WorkflowStateAnnotation } from './state';

export type WorkflowNodeRunners = Record<WorkflowNodeId, WorkflowNodeRunner>;

export interface CreateWorkflowGraphOptions {
  checkpointer: BaseCheckpointSaver;
  runners: WorkflowNodeRunners;
}

/**
 * 十节点拓扑。修改回路用 conditional edge 而不是 Command.goto：
 * - briefFeedback 非空 → 回到 creative_brief；
 * - scenePlanFeedback 非空 → 回到 plan_scenes；
 * - validation 未通过 → END（不保存）。
 */
export function createWorkflowGraph(options: CreateWorkflowGraphOptions) {
  const { runners } = options;

  return new StateGraph(WorkflowStateAnnotation)
    .addNode('scan_assets', runners.scan_assets)
    .addNode('analyze_assets', runners.analyze_assets)
    .addNode('creative_brief', runners.creative_brief)
    .addNode('plan_scenes', runners.plan_scenes)
    .addNode('scene_approval', runners.scene_approval)
    .addNode('synthesize_voice', runners.synthesize_voice)
    .addNode('match_assets', runners.match_assets)
    .addNode('assemble_timeline', runners.assemble_timeline)
    .addNode('validate_project', runners.validate_project)
    .addNode('save_project', runners.save_project)
    .addEdge(START, 'scan_assets')
    .addEdge('scan_assets', 'analyze_assets')
    .addEdge('analyze_assets', 'creative_brief')
    .addConditionalEdges(
      'creative_brief',
      (state) => (state.briefFeedback !== null ? 'creative_brief' : 'plan_scenes'),
      ['creative_brief', 'plan_scenes'],
    )
    .addEdge('plan_scenes', 'scene_approval')
    .addConditionalEdges(
      'scene_approval',
      (state) => (state.scenePlanFeedback !== null ? 'plan_scenes' : 'synthesize_voice'),
      ['plan_scenes', 'synthesize_voice'],
    )
    .addEdge('synthesize_voice', 'match_assets')
    .addEdge('match_assets', 'assemble_timeline')
    .addEdge('assemble_timeline', 'validate_project')
    .addConditionalEdges(
      'validate_project',
      (state) => (state.validationPassed ? 'save_project' : END),
      ['save_project', END],
    )
    .addEdge('save_project', END)
    .compile({
      checkpointer: options.checkpointer,
    });
}
