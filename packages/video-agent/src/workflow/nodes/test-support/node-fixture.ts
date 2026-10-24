import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  AnalyzedAssetCollectionSchema,
  AssetMatchCollectionSchema,
  CreativeBriefContentSchema,
  DraftProjectSchema,
  ScenePlanSchema,
  VoiceSegmentCollectionSchema,
  type AnalyzedAssetCollection,
  type AssetMatchCollection,
  type DraftProject,
  type ProductionSpec,
  type ScenePlan,
  type VoiceSegmentCollection,
} from '@miaoma/video-project';
import { createTempProject, FIXED_NOW } from '../../test-support/fixtures';
import { buildProductionSpec } from '../production-spec';
import { createSilentWav } from '../tts';

export interface NodeFixture {
  projectId: string;
  analysis: AnalyzedAssetCollection;
  scenePlan: ScenePlan;
  voiceSegments: VoiceSegmentCollection;
  matches: AssetMatchCollection;
  spec: ProductionSpec;
  project: DraftProject;
  videoPath: string;
  voicePath: string;
  thumbnailPath: string;
  cleanup: () => Promise<void>;
}

export async function createNodeFixture(): Promise<NodeFixture> {
  const temp = await createTempProject();
  const projectId = 'project-1';
  const videoPath = path.join(temp.directory, 'video-1.mp4');
  const voicePath = path.join(temp.directory, 'voice-scene-01.wav');
  const thumbnailPath = path.join(temp.directory, 'thumb-1.jpg');
  writeFileSync(videoPath, 'fake-video');
  writeFileSync(voicePath, createSilentWav(5_000));
  writeFileSync(thumbnailPath, 'fake-thumbnail');

  const brief = CreativeBriefContentSchema.parse({
    audience: {
      description: '测试受众',
      needs: ['理解核心信息'],
      primary: '测试用户',
    },
    contentType: 'knowledge',
    coreMessage: {
      statement: '核心信息',
      supportingPoints: ['要点一', '要点二'],
    },
    coverageIssues: [],
    durationSeconds: 15,
    narrativeStructure: {
      type: 'hook_explain_cta',
      beats: [
        { estimatedSeconds: 7, label: '开场', purpose: '开场', summary: '开场' },
        { estimatedSeconds: 8, label: '解释', purpose: '解释', summary: '解释' },
      ],
    },
    openQuestions: [],
    style: { pacing: 'medium', toneKeywords: ['清晰'], visualTone: '明亮自然' },
    summary: '测试简报',
    title: '测试视频',
    topic: '测试主题',
  });
  const spec = buildProductionSpec({
    brief,
    voicePresetId: 'wenrou-xuejie',
    specVersion: 1,
  });
  const analysis = AnalyzedAssetCollectionSchema.parse({
    schemaVersion: '1.0.0',
    analysisVersion: 1,
    projectId,
    generatedAt: FIXED_NOW,
    inputFingerprint: 'analysis-fingerprint',
    analysisSource: 'technical',
    assets: [
      {
        assetId: 'asset-1',
        path: videoPath,
        mediaType: 'video',
        durationMs: 10_000,
        width: 1920,
        height: 1080,
        fps: 30,
        keyframes: [
          {
            thumbnailId: 'thumb-1',
            path: thumbnailPath,
            timeMs: 1_000,
            width: 768,
            height: 432,
          },
        ],
        tags: ['横屏', '咖啡'],
        description: '横屏视频，1920x1080，10 秒，30fps。',
        technical: {
          orientation: 'landscape',
          resolutionLabel: '1920x1080',
          durationLabel: '10 秒',
          hasAudio: true,
          isVfr: false,
        },
        status: 'analyzed',
      },
    ],
    failures: [],
  });
  const scenePlan = ScenePlanSchema.parse({
    schemaVersion: '1.0.0',
    scenePlanVersion: 1,
    projectId,
    inputFingerprint: 'scene-fingerprint',
    generatedAt: FIXED_NOW,
    scenes: [
      {
        id: 'scene-01',
        index: 1,
        title: '开场',
        script: '这是一段测试旁白。',
        visualIntent: '咖啡豆特写',
        goal: '抓住注意力',
        notes: '',
        estimatedDurationMs: 5_000,
        shotType: 'cut',
        issues: [],
      },
    ],
    issues: [],
  });
  const voiceSegments = VoiceSegmentCollectionSchema.parse({
    schemaVersion: '1.0.0',
    voiceVersion: 1,
    projectId,
    generatedAt: FIXED_NOW,
    inputFingerprint: 'voice-fingerprint',
    segments: [
      {
        segmentId: 'voice-scene-01',
        sceneId: 'scene-01',
        assetId: 'voice-scene-01',
        path: voicePath,
        durationMs: 5_000,
        isMock: true,
        provider: 'mock-tts',
        voicePresetId: 'wenrou-xuejie',
        speed: 1,
        timingSource: 'mock_estimate',
        subtitles: [{ id: 'cue-scene-01-1', text: '这是一段测试旁白。', startMs: 0, endMs: 5_000 }],
      },
    ],
    failures: [],
  });
  const matches = AssetMatchCollectionSchema.parse({
    schemaVersion: '1.0.0',
    matchVersion: 1,
    projectId,
    generatedAt: FIXED_NOW,
    inputFingerprint: 'match-fingerprint',
    matches: [
      {
        sceneId: 'scene-01',
        requiredDurationMs: 5_000,
        candidates: [{ assetId: 'asset-1', score: 0.9, reasons: ['标签匹配'] }],
        selected: { assetId: 'asset-1', sourceStartMs: 0, sourceEndMs: 5_000 },
        status: 'matched',
        issues: [],
      },
    ],
    unmatchedSceneIds: [],
    issues: [],
  });
  const project = DraftProjectSchema.parse({
    schemaVersion: '1.0.0',
    project: {
      contentRevision: 0,
      createdAt: FIXED_NOW,
      name: '测试项目',
      projectId,
      updatedAt: FIXED_NOW,
    },
    canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
    render: {
      audioBitrateKbps: 192,
      audioCodec: 'aac',
      burnSubtitles: true,
      container: 'mp4',
      sourceAudioMuted: true,
      videoCodec: 'h264',
    },
    assets: {
      music: [],
      subtitles: [],
      thumbnails: [
        {
          id: 'thumb-1',
          path: thumbnailPath,
          timeMs: 1_000,
          width: 768,
          height: 432,
        },
      ],
      videos: [],
      voices: [],
    },
    scenes: [],
    tracks: [],
  });

  return {
    projectId,
    analysis,
    scenePlan,
    voiceSegments,
    matches,
    spec,
    project,
    videoPath,
    voicePath,
    thumbnailPath,
    cleanup: temp.cleanup,
  };
}
