import { z } from 'zod';
import {
  AnalyzedAssetCollectionSchema,
  ApprovalDecisionSchema,
  ApprovalResultSchema,
  CreativeBriefContentSchema,
  CreativeBriefSchema,
  EMPTY_SCRIPT_ANALYSIS_SECTIONS,
  IdSchema,
  ProductionSpecSchema,
  VoicePresetIdSchema,
  getVoicePreset,
  type ApprovalGate,
  type ArtifactReference,
  type CreativeBrief,
  type CreativeBriefContent,
  type ProductionSpec,
  type ScriptAnalysisDraft,
  type ScriptAnalysisSectionsDraft,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import { renderPrompt } from '../prompts';
import { generateScriptAnalysisStreaming } from '../script-analysis-stream';
import { generateStructured } from '../structured-output';
import type { NodeContext, WorkflowNodeSpec } from '../types';
import { writeApprovalResult } from './approval';
import { summarizeAnalyzedAssets } from './asset-summary';
import { buildProductionSpec } from './production-spec';

const APPROVAL_PROMPT = '回复「确认」继续，或直接说明要修改的内容';

const CreativeBriefNodeInputSchema = z.strictObject({
  projectId: IdSchema,
  script: z.string().trim().min(1).max(10_000),
  requirementsText: z.string().trim().min(1).max(2_000).optional(),
  voicePresetId: VoicePresetIdSchema,
  assetSummary: z.string().trim().min(1).max(20_000),
  projectSettings: z.string().trim().min(1).max(2_000),
  feedback: z.string().trim().min(1).max(2_000).optional(),
  previousBriefVersion: z.number().int().nonnegative(),
});

type CreativeBriefNodeInput = z.infer<typeof CreativeBriefNodeInputSchema>;

const CreativeBriefNodeOutputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('approved'),
    brief: CreativeBriefSchema,
    spec: ProductionSpecSchema,
  }),
  z.strictObject({
    kind: z.literal('regenerate'),
    feedback: z.string().trim().min(1).max(2_000),
  }),
]);

type CreativeBriefNodeOutput = z.infer<typeof CreativeBriefNodeOutputSchema>;

async function writeBrief(ctx: NodeContext, brief: CreativeBrief): Promise<ArtifactReference> {
  return ctx.writeArtifact({
    kind: 'creative_brief',
    data: brief,
    schema: CreativeBriefSchema,
    fileName: `analysis/brief/creative-brief.v${brief.briefVersion}.json`,
    version: brief.briefVersion,
    cacheKey: brief.inputFingerprint,
  });
}

async function writeSpec(ctx: NodeContext, spec: ProductionSpec): Promise<ArtifactReference> {
  return ctx.writeArtifact({
    kind: 'production_spec',
    data: spec,
    schema: ProductionSpecSchema,
    fileName: `analysis/spec/production-spec.v${spec.specVersion}.json`,
    version: spec.specVersion,
    cacheKey: spec.contentFingerprint,
  });
}

function briefSummary(brief: CreativeBrief): string {
  return `${brief.title}｜目标 ${brief.durationSeconds} 秒｜节奏 ${brief.style.pacing}｜素材问题 ${
    brief.coverageIssues.length
  } 个`;
}

function specSummary(spec: ProductionSpec): string {
  return `${spec.videoType}｜${spec.aspectRatio} ${spec.resolution} ${spec.fps}fps｜${
    spec.voiceProfile.displayName
  }｜目标 ${spec.durationRange.targetSeconds} 秒`;
}

function toBeatDrafts(brief: CreativeBriefContent): ScriptAnalysisDraft['beats'] {
  return brief.narrativeStructure.beats.map((beat) => ({
    label: beat.label,
    estimatedSeconds: beat.estimatedSeconds,
  }));
}

export const creativeBriefNode: WorkflowNodeSpec<CreativeBriefNodeInput, CreativeBriefNodeOutput> =
  {
    id: 'creative_brief',
    phase: 'prepare',
    inputSchema: CreativeBriefNodeInputSchema,
    outputSchema: CreativeBriefNodeOutputSchema,
    async loadInput(state, ctx): Promise<CreativeBriefNodeInput> {
      const creation = ctx.projects.readCreationInput(state.projectId);
      const voice = getVoicePreset(creation.voicePresetId);
      let assetSummary = '当前没有可用的画面素材。请不要虚构素材。';

      if (state.analysisRef) {
        const analysis = await ctx.readArtifact(state.analysisRef, AnalyzedAssetCollectionSchema);
        assetSummary = summarizeAnalyzedAssets(analysis);
      }

      const latestBrief = state.briefRef ?? (await ctx.artifacts.findLatest('creative_brief'));

      return {
        projectId: state.projectId,
        script: creation.script,
        ...(creation.requirementsText !== undefined
          ? { requirementsText: creation.requirementsText }
          : {}),
        voicePresetId: creation.voicePresetId,
        assetSummary,
        projectSettings: [
          '16:9 横屏 / 1920×1080 / 30fps / 仅 material_edit / 中文',
          `音色：${voice.name}（${voice.description}）`,
          '目标时长 15–300 秒，由文稿与创作要求决定',
        ].join(' / '),
        ...(state.briefFeedback !== null ? { feedback: state.briefFeedback } : {}),
        previousBriefVersion: latestBrief?.version ?? 0,
      };
    },
    async execute(input, ctx): Promise<CreativeBriefNodeOutput> {
      const inputFingerprint = computeFingerprint({
        script: input.script,
        requirementsText: input.requirementsText ?? null,
        assetSummary: input.assetSummary,
        projectSettings: input.projectSettings,
        feedback: input.feedback ?? null,
      });

      const reusable = await ctx.findArtifact('creative_brief', inputFingerprint);
      let brief: CreativeBrief;
      let briefRef: ArtifactReference;

      if (reusable) {
        briefRef = reusable;
        brief = await ctx.readArtifact(reusable, CreativeBriefSchema);
      } else {
        const prompt = ctx.prompts.get('creative-brief');
        const analysisPrompt = ctx.prompts.get('script-analysis');
        const promptVariables = {
          script: input.script,
          requirements: input.requirementsText ?? '无',
          assetSummary: input.assetSummary,
          projectSettings: input.projectSettings,
          feedback: input.feedback ?? '无',
        };
        const user = renderPrompt(prompt.user, promptVariables);
        const analysisUser = renderPrompt(analysisPrompt.user, promptVariables);
        const streamId = `${ctx.runId}:script-analysis`;
        let latestSections: ScriptAnalysisSectionsDraft = { ...EMPTY_SCRIPT_ANALYSIS_SECTIONS };
        let latestBeats: ScriptAnalysisDraft['beats'] = [];
        let currentAttempt = 1;

        const publish = (done: boolean): void => {
          if (ctx.signal?.aborted) {
            return;
          }

          ctx.streams.publish({
            streamId,
            attempt: currentAttempt,
            done,
            draft: { ...latestSections, beats: latestBeats },
          });
        };

        // 结构化简报与流式文稿分析并行：前者负责下游数据，后者负责消息页展示。
        const analysisPromise = generateScriptAnalysisStreaming({
          provider: ctx.llm,
          system: analysisPrompt.system,
          user: analysisUser,
          temperature: 0.6,
          maxOutputTokens: 4_000,
          signal: ctx.signal,
          onPartial: (sections, attempt) => {
            currentAttempt = attempt;
            latestSections = sections;
            publish(false);
          },
        });
        const briefPromise = generateStructured({
          provider: ctx.llm,
          schema: CreativeBriefContentSchema,
          system: prompt.system,
          user,
          temperature: 0.6,
          maxOutputTokens: 4_000,
          signal: ctx.signal,
        }).then((generated) => {
          latestBeats = toBeatDrafts(generated.data);
          publish(false);
          return generated;
        });

        const [generated, analysis] = await Promise.all([briefPromise, analysisPromise]);
        const briefVersion = input.previousBriefVersion + 1;

        latestSections = analysis.content;
        latestBeats = toBeatDrafts(generated.data);
        publish(true);

        brief = CreativeBriefSchema.parse({
          ...generated.data,
          scriptAnalysis: analysis.content,
          briefVersion,
          generatedAt: ctx.now().toISOString(),
          inputFingerprint,
          schemaVersion: '1.0.0',
        });
        briefRef = await writeBrief(ctx, brief);
      }

      const a1 = ctx.interrupt(
        {
          gate: 'A1',
          artifact: briefRef,
          title: '创意简报与方案确认',
          summary: briefSummary(brief),
          prompt: APPROVAL_PROMPT,
        },
        ApprovalDecisionSchema,
      );
      await writeApprovalResult(ctx, { gate: 'A1', decision: a1, artifact: briefRef });

      if (a1.decision === 'request_changes') {
        return { kind: 'regenerate', feedback: a1.feedback };
      }

      const spec = buildProductionSpec({
        brief,
        voicePresetId: input.voicePresetId,
        specVersion: brief.briefVersion,
      });
      const specRef = await writeSpec(ctx, spec);
      const a2 = ctx.interrupt(
        {
          gate: 'A2',
          artifact: specRef,
          title: '成片需求确认',
          summary: specSummary(spec),
          prompt: APPROVAL_PROMPT,
        },
        ApprovalDecisionSchema,
      );
      await writeApprovalResult(ctx, { gate: 'A2', decision: a2, artifact: specRef });

      if (a2.decision === 'request_changes') {
        return { kind: 'regenerate', feedback: a2.feedback };
      }

      return { kind: 'approved', brief, spec };
    },
    async persist(output, ctx) {
      if (output.kind === 'regenerate') {
        return {
          briefFeedback: output.feedback,
          specRef: null,
          a1ApprovalRef: null,
          a2ApprovalRef: null,
        };
      }

      const briefRef = await writeBrief(ctx, output.brief);
      const specRef = await writeSpec(ctx, output.spec);
      const a1 = await writeApprovalResult(ctx, {
        gate: 'A1',
        decision: { decision: 'approve' },
        artifact: briefRef,
      });
      const a2 = await writeApprovalResult(ctx, {
        gate: 'A2',
        decision: { decision: 'approve' },
        artifact: specRef,
      });

      return {
        briefRef,
        specRef,
        a1ApprovalRef: a1.reference,
        a2ApprovalRef: a2.reference,
        briefFeedback: null,
      };
    },
  };

export async function assertWorkflowApproval(
  ctx: NodeContext,
  gate: ApprovalGate,
  approvalRef: ArtifactReference | null,
  expectedArtifact: ArtifactReference | null,
): Promise<void> {
  if (!approvalRef) {
    throw new WorkflowError('WORKFLOW_INPUT_MISSING', `缺少 ${gate} 审批。`);
  }

  if (!expectedArtifact) {
    throw new WorkflowError('WORKFLOW_INPUT_MISSING', `缺少 ${gate} 对应的产物。`);
  }

  const approval = await ctx.readArtifact(approvalRef, ApprovalResultSchema);

  if (approval.gate !== gate || approval.decision !== 'approve') {
    throw new WorkflowError('WORKFLOW_STALE_APPROVAL', `${gate} 审批未通过。`);
  }

  if (
    approval.artifact.version !== expectedArtifact.version ||
    approval.artifact.contentFingerprint !== expectedArtifact.contentFingerprint
  ) {
    throw new WorkflowError('WORKFLOW_STALE_APPROVAL', `${gate} 审批已过期。`);
  }
}
