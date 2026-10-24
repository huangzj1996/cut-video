import type { WorkflowNodeRunners } from '../graph';
import { createAttemptCounters, createNodeRunner } from '../node-wrapper';
import type { WorkflowServices } from '../types';
import { analyzeAssetsNode } from './analyze-assets';
import { assembleTimelineNode } from './assemble-timeline';
import { creativeBriefNode } from './creative-brief';
import { matchAssetsNode } from './match-assets';
import { planScenesNode } from './plan-scenes';
import { saveProjectNode } from './save-project';
import { scanAssetsNode } from './scan-assets';
import { sceneApprovalNode } from './scene-approval';
import { synthesizeVoiceNode } from './synthesize-voice';
import { validateProjectNode } from './validate-project';

/**
 * 组装十节点图的 runner 注册表。attempt 计数器在一次 run 内共享，
 * 这样节点重试/resume 时事件里的 attempt 会递增。
 */
export function createWorkflowRunners(services: WorkflowServices): WorkflowNodeRunners {
  const counters = createAttemptCounters();

  return {
    scan_assets: createNodeRunner(scanAssetsNode, services, counters),
    analyze_assets: createNodeRunner(analyzeAssetsNode, services, counters),
    creative_brief: createNodeRunner(creativeBriefNode, services, counters),
    plan_scenes: createNodeRunner(planScenesNode, services, counters),
    scene_approval: createNodeRunner(sceneApprovalNode, services, counters),
    synthesize_voice: createNodeRunner(synthesizeVoiceNode, services, counters),
    match_assets: createNodeRunner(matchAssetsNode, services, counters),
    assemble_timeline: createNodeRunner(assembleTimelineNode, services, counters),
    validate_project: createNodeRunner(validateProjectNode, services, counters),
    save_project: createNodeRunner(saveProjectNode, services, counters),
  };
}
