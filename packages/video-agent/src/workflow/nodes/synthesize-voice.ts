import { z } from 'zod';
import {
  IdSchema,
  ScenePlanSchema,
  VoicePresetIdSchema,
  VoiceSegmentCollectionSchema,
  getVoicePreset,
  type VoiceSegment,
  type VoiceSegmentCollection,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import type { WorkflowNodeSpec } from '../types';
import { assertWorkflowApproval } from './creative-brief';
import { buildSubtitleCues, createSilentWav, estimateSpeechDurationMs } from './tts';

const SynthesizeVoiceInputSchema = z.strictObject({
  projectId: IdSchema,
  scenePlan: ScenePlanSchema,
  voicePresetId: VoicePresetIdSchema,
  previousVoiceVersion: z.number().int().nonnegative(),
});

type SynthesizeVoiceInput = z.infer<typeof SynthesizeVoiceInputSchema>;

function buildVoiceSegments(
  input: SynthesizeVoiceInput,
  paths: Map<string, string>,
  generatedAt: string,
): VoiceSegmentCollection {
  const preset = getVoicePreset(input.voicePresetId);
  const segments: VoiceSegment[] = input.scenePlan.scenes.map((scene) => {
    const durationMs = estimateSpeechDurationMs(scene.script, preset.speed);
    const path = paths.get(scene.id);

    if (!path) {
      throw new WorkflowError('WORKFLOW_STEP_FAILED', `场景 ${scene.id} 的配音文件未写入。`);
    }

    return {
      segmentId: `voice-${scene.id}`,
      sceneId: scene.id,
      assetId: `voice-${scene.id}`,
      path,
      durationMs,
      isMock: true,
      provider: 'mock-tts',
      voicePresetId: input.voicePresetId,
      speed: preset.speed,
      timingSource: 'mock_estimate',
      subtitles: buildSubtitleCues(scene.id, scene.script, durationMs),
    };
  });

  return VoiceSegmentCollectionSchema.parse({
    schemaVersion: '1.0.0',
    voiceVersion: input.previousVoiceVersion + 1,
    projectId: input.projectId,
    generatedAt,
    inputFingerprint: computeFingerprint({
      scenePlan: input.scenePlan,
      voicePresetId: input.voicePresetId,
      speed: preset.speed,
    }),
    segments,
    failures: [],
  });
}

export const synthesizeVoiceNode: WorkflowNodeSpec<SynthesizeVoiceInput, VoiceSegmentCollection> = {
  id: 'synthesize_voice',
  phase: 'voice',
  inputSchema: SynthesizeVoiceInputSchema,
  outputSchema: VoiceSegmentCollectionSchema,
  async loadInput(state, ctx): Promise<SynthesizeVoiceInput> {
    if (!state.scenePlanRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少已批准分镜。');
    }

    const scenePlan = await ctx.readArtifact(state.scenePlanRef, ScenePlanSchema);
    const creation = ctx.projects.readCreationInput(state.projectId);

    await assertWorkflowApproval(ctx, 'A3', state.a3ApprovalRef, state.scenePlanRef);
    const latestVoice = state.voiceRef ?? (await ctx.artifacts.findLatest('voice_segments'));

    return {
      projectId: state.projectId,
      scenePlan,
      voicePresetId: creation.voicePresetId,
      previousVoiceVersion: latestVoice?.version ?? 0,
    };
  },
  async execute(input, ctx): Promise<VoiceSegmentCollection> {
    const preset = getVoicePreset(input.voicePresetId);
    const inputFingerprint = computeFingerprint({
      scenePlan: input.scenePlan,
      voicePresetId: input.voicePresetId,
      speed: preset.speed,
    });
    const reusable = await ctx.findArtifact('voice_segments', inputFingerprint);

    if (reusable) {
      return ctx.readArtifact(reusable, VoiceSegmentCollectionSchema);
    }

    const paths = new Map<string, string>();

    for (const scene of input.scenePlan.scenes) {
      ctx.throwIfAborted();
      const durationMs = estimateSpeechDurationMs(scene.script, preset.speed);
      const relativePath = `generated/voices/${ctx.runId}/${scene.id}.wav`;
      const absolutePath = await ctx.artifacts.writeFile(relativePath, createSilentWav(durationMs));
      paths.set(scene.id, absolutePath);
    }

    return buildVoiceSegments(input, paths, ctx.now().toISOString());
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'voice_segments',
      data: output,
      schema: VoiceSegmentCollectionSchema,
      fileName: `analysis/voices/voice-segments.v${output.voiceVersion}.json`,
      version: output.voiceVersion,
      cacheKey: output.inputFingerprint,
    });

    return { voiceRef: reference };
  },
};
