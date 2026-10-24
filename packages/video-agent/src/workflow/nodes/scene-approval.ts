import { z } from 'zod';
import {
  ApprovalDecisionSchema,
  ApprovalResultSchema,
  IdSchema,
  ScenePlanSchema,
  type ArtifactReference,
  type ScenePlan,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import type { WorkflowNodeSpec } from '../types';
import { formatDuration } from './asset-summary';
import { writeApprovalResult } from './approval';

const SceneApprovalInputSchema = z.strictObject({
  projectId: IdSchema,
  scenePlan: ScenePlanSchema,
});

type SceneApprovalInput = z.infer<typeof SceneApprovalInputSchema>;

const SceneApprovalOutputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('approved'),
    approval: ApprovalResultSchema,
  }),
  z.strictObject({
    kind: z.literal('regenerate'),
    feedback: z.string().trim().min(1).max(2_000),
  }),
]);

type SceneApprovalOutput = z.infer<typeof SceneApprovalOutputSchema>;

function planSummary(plan: ScenePlan): string {
  const totalMs = plan.scenes.reduce((total, scene) => total + scene.estimatedDurationMs, 0);

  return `共 ${plan.scenes.length} 个分镜，预计 ${formatDuration(totalMs)}｜版本 v${plan.scenePlanVersion}`;
}

export const sceneApprovalNode: WorkflowNodeSpec<SceneApprovalInput, SceneApprovalOutput> = {
  id: 'scene_approval',
  phase: 'storyboard',
  inputSchema: SceneApprovalInputSchema,
  outputSchema: SceneApprovalOutputSchema,
  async loadInput(state, ctx): Promise<SceneApprovalInput> {
    if (!state.scenePlanRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少待审批分镜。');
    }

    return {
      projectId: state.projectId,
      scenePlan: await ctx.readArtifact(state.scenePlanRef, ScenePlanSchema),
    };
  },
  async execute(input, ctx): Promise<SceneApprovalOutput> {
    const scenePlanRef: ArtifactReference | null = await ctx.findArtifact(
      'scene_plan',
      input.scenePlan.inputFingerprint,
    );

    if (!scenePlanRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '分镜产物尚未落盘。');
    }

    const decision = ctx.interrupt(
      {
        gate: 'A3',
        artifact: scenePlanRef,
        title: '分镜待确认',
        summary: planSummary(input.scenePlan),
        prompt: '回复「确认」继续，或直接说明要修改的内容',
      },
      ApprovalDecisionSchema,
    );
    const approval = await writeApprovalResult(ctx, {
      gate: 'A3',
      decision,
      artifact: scenePlanRef,
    });

    if (decision.decision === 'request_changes') {
      return { kind: 'regenerate', feedback: decision.feedback };
    }

    return { kind: 'approved', approval: approval.result };
  },
  async persist(output, ctx) {
    if (output.kind === 'regenerate') {
      return {
        scenePlanFeedback: output.feedback,
        a3ApprovalRef: null,
      };
    }

    const reference = await ctx.writeArtifact({
      kind: 'approval',
      data: output.approval,
      schema: ApprovalResultSchema,
      fileName: `analysis/approvals/${output.approval.approvalId}.json`,
      version: output.approval.artifact.version,
      cacheKey: output.approval.approvalId,
    });

    return {
      a3ApprovalRef: reference,
      scenePlanFeedback: null,
    };
  },
};
