import { z } from 'zod';
import {
  AnalyzedAssetCollectionSchema,
  AssetMatchCollectionSchema,
  IdSchema,
  ProductionSpecSchema,
  ScenePlanSchema,
  StoredProjectSchema,
  VideoProjectSchema,
  VoiceSegmentCollectionSchema,
  type Scene,
  type SubtitleAsset,
  type SubtitleClip,
  type TimelineTrack,
  type VideoAsset,
  type VideoClip,
  type VideoProject,
  type VoiceAsset,
  type VoiceClip,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import type { WorkflowNodeSpec } from '../types';

const AssembleTimelineInputSchema = z.strictObject({
  projectId: IdSchema,
  scenePlan: ScenePlanSchema,
  voiceSegments: VoiceSegmentCollectionSchema,
  matches: AssetMatchCollectionSchema,
  analysis: AnalyzedAssetCollectionSchema,
  spec: ProductionSpecSchema,
  project: StoredProjectSchema,
});

type AssembleTimelineInput = z.infer<typeof AssembleTimelineInputSchema>;

interface TimelineBuildResult {
  project: VideoProject;
  durationMs: number;
}

function buildVideoAssets(input: AssembleTimelineInput): {
  videos: VideoAsset[];
  thumbnails: VideoProject['assets']['thumbnails'];
} {
  const thumbnailsById = new Map(
    input.project.assets.thumbnails.map((thumbnail) => [thumbnail.id, thumbnail]),
  );
  const videos: VideoAsset[] = input.analysis.assets.map((asset) => ({
    id: asset.assetId,
    path: asset.path,
    mediaType: asset.mediaType,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    ...(asset.mediaType === 'video' ? { fps: asset.fps ?? 30 } : {}),
    thumbnailIds: asset.keyframes
      .map((frame) => frame.thumbnailId)
      .filter((id) => thumbnailsById.has(id)),
  }));
  const referencedIds = new Set(videos.flatMap((video) => video.thumbnailIds));
  const thumbnails = input.project.assets.thumbnails.filter((thumbnail) =>
    referencedIds.has(thumbnail.id),
  );

  return { videos, thumbnails };
}

function buildVoices(input: AssembleTimelineInput): {
  voices: VoiceAsset[];
  subtitles: SubtitleAsset[];
} {
  const voices = input.voiceSegments.segments.map((segment) => ({
    id: segment.assetId,
    path: segment.path,
    durationMs: segment.durationMs,
    isMock: segment.isMock,
    provider: segment.provider,
    voice: segment.voicePresetId,
  }));
  const subtitles = input.voiceSegments.segments.flatMap((segment) =>
    segment.subtitles.map((cue) => ({
      id: cue.id,
      language: 'zh-CN',
      text: cue.text,
    })),
  );

  return { voices, subtitles };
}

function buildTimeline(input: AssembleTimelineInput, runId: string, now: string): VideoProject {
  const { videos, thumbnails } = buildVideoAssets(input);
  const { voices, subtitles } = buildVoices(input);
  const videoById = new Map(videos.map((video) => [video.id, video]));
  const voiceByScene = new Map(
    input.voiceSegments.segments.map((segment) => [segment.sceneId, segment]),
  );
  const matchByScene = new Map(input.matches.matches.map((match) => [match.sceneId, match]));
  const scenes: Scene[] = [];
  const videoClips: VideoClip[] = [];
  const voiceClips: VoiceClip[] = [];
  const subtitleClips: SubtitleClip[] = [];
  let cursorMs = 0;

  for (const planScene of input.scenePlan.scenes) {
    const voice = voiceByScene.get(planScene.id);
    const match = matchByScene.get(planScene.id);
    const durationMs = voice?.durationMs ?? planScene.estimatedDurationMs;
    const startMs = cursorMs;
    const endMs = startMs + durationMs;
    cursorMs = endMs;

    if (!voice) {
      continue;
    }

    const selected = match?.selected;
    const video = selected ? videoById.get(selected.assetId) : undefined;

    if (selected && video) {
      videoClips.push({
        id: `clip-video-${planScene.id}`,
        kind: 'video',
        sceneId: planScene.id,
        assetId: selected.assetId,
        startMs,
        endMs,
        sourceStartMs: selected.sourceStartMs,
        sourceEndMs: selected.sourceEndMs,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        transform: { x: 0, y: 0, scale: 1 },
      });
    }

    voiceClips.push({
      id: `clip-voice-${planScene.id}`,
      kind: 'voice',
      sceneId: planScene.id,
      assetId: voice.assetId,
      startMs,
      endMs,
      voicePreset: voice.voicePresetId,
      volume: 1,
    });

    for (const cue of voice.subtitles) {
      subtitleClips.push({
        id: `clip-sub-${cue.id}`,
        kind: 'subtitle',
        sceneId: planScene.id,
        assetId: cue.id,
        startMs: startMs + cue.startMs,
        endMs: startMs + cue.endMs,
        text: cue.text,
      });
    }

    scenes.push({
      id: planScene.id,
      index: planScene.index,
      title: planScene.title,
      script: planScene.script,
      visualIntent: planScene.visualIntent,
      goal: planScene.goal,
      notes: planScene.notes,
      durationMs,
      voiceAssetId: voice.assetId,
      subtitleIds: voice.subtitles.map((cue) => cue.id),
      matchedVideoAssetIds: selected && video ? [selected.assetId] : [],
    });
  }

  const tracks: TimelineTrack[] = [
    { id: 'track-video', kind: 'video', clips: videoClips },
    { id: 'track-voice', kind: 'voice', clips: voiceClips },
    {
      id: 'track-subtitle',
      kind: 'subtitle',
      clips: subtitleClips,
      style: input.spec.subtitleStyle,
      visible: true,
    },
    { id: 'track-music', kind: 'music', clips: [] },
  ];
  const inputFingerprint = computeFingerprint({
    scenePlan: input.scenePlan,
    voiceSegments: input.voiceSegments,
    matches: input.matches,
    analysis: input.analysis,
    spec: input.spec,
    contentRevision: input.project.project.contentRevision,
  });

  return VideoProjectSchema.parse({
    schemaVersion: '1.0.0',
    project: {
      ...input.project.project,
      contentRevision: input.project.project.contentRevision + 1,
      updatedAt: now,
    },
    canvas: input.project.canvas,
    render: input.project.render,
    assets: {
      videos,
      thumbnails,
      voices,
      subtitles,
      music: input.project.assets.music,
    },
    scenes,
    tracks,
    ai: {
      inputFingerprint,
      model: 'deepseek-chat',
      modelConfigVersion: 'v1',
      provider: 'deepseek',
      runId,
      startedAt: now,
    },
  });
}

export function assembleTimeline(
  input: AssembleTimelineInput,
  runId: string,
  now: string,
): TimelineBuildResult {
  const totalDurationMs = input.scenePlan.scenes.reduce(
    (total, scene) =>
      total +
      (input.voiceSegments.segments.find((segment) => segment.sceneId === scene.id)?.durationMs ??
        scene.estimatedDurationMs),
    0,
  );
  const project = buildTimeline(input, runId, now);

  return { project, durationMs: totalDurationMs };
}

export const assembleTimelineNode: WorkflowNodeSpec<AssembleTimelineInput, VideoProject> = {
  id: 'assemble_timeline',
  phase: 'video',
  inputSchema: AssembleTimelineInputSchema,
  outputSchema: VideoProjectSchema,
  async loadInput(state, ctx): Promise<AssembleTimelineInput> {
    if (
      !state.scenePlanRef ||
      !state.voiceRef ||
      !state.matchRef ||
      !state.analysisRef ||
      !state.specRef
    ) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '组装时间线缺少必要产物。');
    }

    const [scenePlan, voiceSegments, matches, analysis, spec] = await Promise.all([
      ctx.readArtifact(state.scenePlanRef, ScenePlanSchema),
      ctx.readArtifact(state.voiceRef, VoiceSegmentCollectionSchema),
      ctx.readArtifact(state.matchRef, AssetMatchCollectionSchema),
      ctx.readArtifact(state.analysisRef, AnalyzedAssetCollectionSchema),
      ctx.readArtifact(state.specRef, ProductionSpecSchema),
    ]);

    return {
      projectId: state.projectId,
      scenePlan,
      voiceSegments,
      matches,
      analysis,
      spec,
      project: ctx.projects.read(state.projectId),
    };
  },
  async execute(input, ctx): Promise<VideoProject> {
    return assembleTimeline(input, ctx.runId, ctx.now().toISOString()).project;
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'video_project',
      data: output,
      schema: VideoProjectSchema,
      fileName: `analysis/timeline/video-project.v${output.project.contentRevision}.json`,
      version: output.project.contentRevision,
      cacheKey: output.ai.inputFingerprint,
    });

    return { projectRef: reference };
  },
};
