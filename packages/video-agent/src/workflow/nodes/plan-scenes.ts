import { z } from 'zod';
import {
  AnalyzedAssetCollectionSchema,
  CreativeBriefSchema,
  IdSchema,
  ProductionSpecSchema,
  ScenePlanContentSchema,
  ScenePlanSchema,
  type ScenePlan,
  type ScenePlanContent,
  type ScenePlanIssue,
  type ScenePlanScene,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import { renderPrompt } from '../prompts';
import { generateStructured } from '../structured-output';
import type { WorkflowNodeSpec } from '../types';
import { summarizeAnalyzedAssets } from './asset-summary';
import { assertWorkflowApproval } from './creative-brief';

const PlanScenesInputSchema = z.strictObject({
  projectId: IdSchema,
  brief: CreativeBriefSchema,
  spec: ProductionSpecSchema,
  script: z.string().trim().min(1).max(10_000),
  assetSummary: z.string().trim().min(1).max(20_000),
  feedback: z.string().trim().min(1).max(2_000).optional(),
  previousScenePlanVersion: z.number().int().nonnegative(),
});

type PlanScenesInput = z.infer<typeof PlanScenesInputSchema>;

function sceneId(index: number): string {
  return `scene-${String(index + 1).padStart(2, '0')}`;
}

function toScenePlan(
  content: ScenePlanContent,
  input: PlanScenesInput,
  inputFingerprint: string,
  generatedAt: string,
): ScenePlan {
  const scenes: ScenePlanScene[] = content.scenes.map((scene, position) => ({
    id: sceneId(position),
    index: position + 1,
    title: scene.title,
    script: scene.script,
    visualIntent: scene.visualIntent,
    goal: scene.goal,
    notes: scene.notes ?? '',
    estimatedDurationMs: scene.estimatedSeconds * 1_000,
    shotType: 'cut',
    issues: [],
  }));
  const issues: ScenePlanIssue[] = (content.issues ?? []).map((message) => ({
    code: 'PLAN_NOTE',
    severity: 'info' as const,
    message,
  }));
  const totalMs = scenes.reduce((total, scene) => total + scene.estimatedDurationMs, 0);
  const targetMs = input.brief.durationSeconds * 1_000;
  const toleranceMs = Math.max(5_000, Math.round(targetMs * 0.2));

  if (Math.abs(totalMs - targetMs) > toleranceMs) {
    issues.push({
      code: 'DURATION_MISMATCH',
      severity: 'warning',
      message: `分镜总时长 ${Math.round(totalMs / 1_000)} 秒与目标 ${
        input.brief.durationSeconds
      } 秒偏差超过 ${Math.round(toleranceMs / 1_000)} 秒。`,
    });
  }

  return ScenePlanSchema.parse({
    schemaVersion: '1.0.0',
    scenePlanVersion: input.previousScenePlanVersion + 1,
    projectId: input.projectId,
    inputFingerprint,
    generatedAt,
    scenes,
    issues,
  });
}

export const planScenesNode: WorkflowNodeSpec<PlanScenesInput, ScenePlan> = {
  id: 'plan_scenes',
  phase: 'storyboard',
  inputSchema: PlanScenesInputSchema,
  outputSchema: ScenePlanSchema,
  async loadInput(state, ctx): Promise<PlanScenesInput> {
    if (!state.briefRef || !state.specRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少已确认的创意简报或成片需求。');
    }

    const [brief, spec] = await Promise.all([
      ctx.readArtifact(state.briefRef, CreativeBriefSchema),
      ctx.readArtifact(state.specRef, ProductionSpecSchema),
    ]);
    await assertWorkflowApproval(ctx, 'A2', state.a2ApprovalRef, state.specRef);
    const creation = ctx.projects.readCreationInput(state.projectId);
    let assetSummary = '当前没有可用的画面素材。请不要虚构素材。';

    if (state.analysisRef) {
      const analysis = await ctx.readArtifact(state.analysisRef, AnalyzedAssetCollectionSchema);
      assetSummary = summarizeAnalyzedAssets(analysis);
    }

    const latestPlan = state.scenePlanRef ?? (await ctx.artifacts.findLatest('scene_plan'));

    return {
      projectId: state.projectId,
      brief,
      spec,
      script: creation.script,
      assetSummary,
      ...(state.scenePlanFeedback !== null ? { feedback: state.scenePlanFeedback } : {}),
      previousScenePlanVersion: latestPlan?.version ?? 0,
    };
  },
  async execute(input, ctx): Promise<ScenePlan> {
    const inputFingerprint = computeFingerprint({
      brief: input.brief,
      spec: input.spec,
      script: input.script,
      assetSummary: input.assetSummary,
      feedback: input.feedback ?? null,
    });
    const reusable = await ctx.findArtifact('scene_plan', inputFingerprint);

    if (reusable) {
      return ctx.readArtifact(reusable, ScenePlanSchema);
    }

    const prompt = ctx.prompts.get('plan-scenes');
    const user = renderPrompt(prompt.user, {
      brief: JSON.stringify(input.brief),
      spec: JSON.stringify(input.spec),
      script: input.script,
      assetSummary: input.assetSummary,
      feedback: input.feedback ?? '无',
    });
    const generated = await generateStructured({
      provider: ctx.llm,
      schema: ScenePlanContentSchema,
      system: prompt.system,
      user,
      temperature: 0.5,
      maxOutputTokens: 4_000,
      signal: ctx.signal,
    });

    return toScenePlan(generated.data, input, inputFingerprint, ctx.now().toISOString());
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'scene_plan',
      data: output,
      schema: ScenePlanSchema,
      fileName: `analysis/scenes/scene-plan.v${output.scenePlanVersion}.json`,
      version: output.scenePlanVersion,
      cacheKey: output.inputFingerprint,
    });

    return {
      scenePlanRef: reference,
      scenePlanFeedback: null,
    };
  },
};
