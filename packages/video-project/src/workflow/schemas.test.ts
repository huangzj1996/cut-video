import { describe, expect, it } from 'vitest';
import {
  AnalyzedAssetCollectionSchema,
  ApprovalDecisionSchema,
  ArtifactReferenceSchema,
  AssetManifestSchema,
  AssetMatchCollectionSchema,
  CreationInputDraftSchema,
  ProductionSpecSchema,
  RunEventSchema,
  SavedProjectRefSchema,
  ScenePlanSchema,
  ValidationReportSchema,
  VOICE_PRESET_IDS,
  VOICE_PRESETS,
  VoiceSegmentCollectionSchema,
  WorkflowStateSchema,
  getVoicePreset,
} from './index';

const NOW = '2026-10-24T00:00:00.000Z';

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'creative_brief',
    ref: 'analysis/brief/creative-brief.v1.json',
    version: 1,
    contentFingerprint: 'a'.repeat(64),
    createdAt: NOW,
    ...overrides,
  };
}

function productionSpec(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0',
    specVersion: 1,
    contentFingerprint: 'abc',
    videoType: '知识口播',
    recommendedScheme: 'material_edit',
    visualStyle: '简洁明亮',
    palette: { name: '中性自然', description: '低饱和暖色' },
    font: { family: '思源黑体', usage: '字幕与标题' },
    voiceProfile: {
      presetId: 'wenrou-xuejie',
      displayName: '温婉学姐',
      description: '柔和亲切',
      speed: 1,
    },
    subtitleStyle: { presetId: 'white-outline', fontSize: 40 },
    materialStrategy: '按分镜语义匹配已导入素材',
    rhythm: '短句、快节奏',
    deliverySpec: {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrateKbps: 192,
      burnSubtitles: true,
    },
    aspectRatio: '16:9',
    resolution: '1920x1080',
    fps: 30,
    durationRange: { minSeconds: 45, maxSeconds: 75, targetSeconds: 60 },
    sourceAudioMuted: true,
    normalizationNotes: [],
    ...overrides,
  };
}

function scenePlan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0',
    scenePlanVersion: 1,
    projectId: 'project-1',
    inputFingerprint: 'fp',
    generatedAt: NOW,
    scenes: [
      {
        id: 'scene-01',
        index: 1,
        title: '开场',
        script: '先看结论。',
        visualIntent: '城市清晨空镜',
        goal: '抓住注意力',
        notes: '',
        estimatedDurationMs: 5_000,
        shotType: 'cut',
        issues: [],
      },
    ],
    issues: [],
    ...overrides,
  };
}

describe('workflow artifact schemas', () => {
  it('accepts a project-relative artifact ref', () => {
    expect(ArtifactReferenceSchema.safeParse(artifact()).success).toBe(true);
  });

  it.each([
    ['absolute path', '/analysis/brief.json'],
    ['windows path', 'analysis\\brief.json'],
    ['drive path', 'C:/analysis/brief.json'],
    ['parent traversal', 'analysis/../brief.json'],
  ])('rejects %s', (_label, ref) => {
    expect(ArtifactReferenceSchema.safeParse(artifact({ ref })).success).toBe(false);
  });
});

describe('voice presets', () => {
  it('exposes four unique presets with stable ids', () => {
    expect(VOICE_PRESETS).toHaveLength(4);
    expect(new Set(VOICE_PRESETS.map((preset) => preset.id))).toEqual(new Set(VOICE_PRESET_IDS));
    expect(getVoicePreset('wenrou-xuejie').name).toBe('温婉学姐');
  });
});

describe('creation input', () => {
  it('accepts a draft and trims text', () => {
    const parsed = CreationInputDraftSchema.parse({
      script: '  一段口播文稿。  ',
      voicePresetId: 'wenrou-xuejie',
    });

    expect(parsed.script).toBe('一段口播文稿。');
  });

  it('rejects unknown voice presets and empty scripts', () => {
    expect(
      CreationInputDraftSchema.safeParse({ script: 'x', voicePresetId: 'unknown' }).success,
    ).toBe(false);
    expect(
      CreationInputDraftSchema.safeParse({ script: '   ', voicePresetId: 'wenrou-xuejie' }).success,
    ).toBe(false);
  });
});

describe('asset manifest', () => {
  it('accepts an empty manifest when no asset path was supplied', () => {
    const parsed = AssetManifestSchema.safeParse({
      schemaVersion: '1.0.0',
      manifestVersion: 1,
      projectId: 'project-1',
      scannedAt: NOW,
      roots: [],
      items: [],
      stats: {
        filesSeen: 0,
        directoriesVisited: 0,
        duplicates: 0,
        rejected: 0,
        unreadable: 0,
      },
      issues: [{ code: 'NO_ASSET_PATH', message: '未选择素材目录。' }],
    });

    expect(parsed.success).toBe(true);
  });
});

describe('analyzed assets', () => {
  it('accepts technical analysis results', () => {
    expect(
      AnalyzedAssetCollectionSchema.safeParse({
        schemaVersion: '1.0.0',
        analysisVersion: 1,
        projectId: 'project-1',
        generatedAt: NOW,
        inputFingerprint: 'fp',
        analysisSource: 'technical',
        assets: [
          {
            assetId: 'asset-1',
            path: 'C:/assets/a.mp4',
            mediaType: 'video',
            durationMs: 10_000,
            width: 1920,
            height: 1080,
            fps: 30,
            keyframes: [],
            tags: ['横屏', '城市'],
            description: '横屏视频，1920×1080，10 秒。',
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
      }).success,
    ).toBe(true);
  });
});

describe('production spec', () => {
  it('accepts v1 delivery settings', () => {
    expect(ProductionSpecSchema.safeParse(productionSpec()).success).toBe(true);
  });

  it.each([
    ['vertical', { aspectRatio: '9:16' }],
    ['vertical resolution', { resolution: '1080x1920' }],
    ['24fps', { fps: 24 }],
    ['mg animation', { recommendedScheme: 'mg_animation' }],
    ['unmuted source', { sourceAudioMuted: false }],
  ])('rejects %s', (_label, override) => {
    expect(ProductionSpecSchema.safeParse(productionSpec(override)).success).toBe(false);
  });

  it('rejects inconsistent duration ranges', () => {
    expect(
      ProductionSpecSchema.safeParse(
        productionSpec({ durationRange: { minSeconds: 60, maxSeconds: 50, targetSeconds: 55 } }),
      ).success,
    ).toBe(false);
  });
});

describe('scene plan', () => {
  it('accepts a versioned scene plan', () => {
    expect(ScenePlanSchema.safeParse(scenePlan()).success).toBe(true);
  });

  it('rejects duplicate scene ids and non-sequential indexes', () => {
    const duplicate = scenePlan({
      scenes: [
        {
          id: 'scene-01',
          index: 1,
          title: '开场',
          script: 'a',
          visualIntent: 'b',
          goal: 'c',
          notes: '',
          estimatedDurationMs: 1_000,
          shotType: 'cut',
          issues: [],
        },
        {
          id: 'scene-01',
          index: 2,
          title: '主体',
          script: 'd',
          visualIntent: 'e',
          goal: 'f',
          notes: '',
          estimatedDurationMs: 1_000,
          shotType: 'cut',
          issues: [],
        },
      ],
    });

    expect(ScenePlanSchema.safeParse(duplicate).success).toBe(false);
  });
});

describe('approval decisions', () => {
  it('accepts approve and request_changes with feedback', () => {
    expect(ApprovalDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(
      ApprovalDecisionSchema.safeParse({
        decision: 'request_changes',
        feedback: '第二个分镜更突出产品',
      }).success,
    ).toBe(true);
  });

  it('rejects request_changes without feedback', () => {
    expect(ApprovalDecisionSchema.safeParse({ decision: 'request_changes' }).success).toBe(false);
  });
});

describe('voice segments', () => {
  function collection(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: '1.0.0',
      voiceVersion: 1,
      projectId: 'project-1',
      generatedAt: NOW,
      inputFingerprint: 'fp',
      segments: [
        {
          segmentId: 'voice-1',
          sceneId: 'scene-01',
          assetId: 'asset-voice-1',
          path: 'C:/project/generated/voices/scene-01.wav',
          durationMs: 5_000,
          isMock: true,
          provider: 'mock-tts',
          voicePresetId: 'wenrou-xuejie',
          speed: 1,
          timingSource: 'mock_estimate',
          subtitles: [{ id: 'cue-1', text: '先看结论。', startMs: 0, endMs: 2_000 }],
        },
      ],
      failures: [],
      ...overrides,
    };
  }

  it('accepts mock voice segments', () => {
    expect(VoiceSegmentCollectionSchema.safeParse(collection()).success).toBe(true);
  });

  it('rejects subtitle cues outside the segment duration', () => {
    const invalid = collection({
      segments: [
        {
          ...collection().segments[0],
          subtitles: [{ id: 'cue-1', text: 'x', startMs: 0, endMs: 6_000 }],
        },
      ],
    });

    expect(VoiceSegmentCollectionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('asset matches', () => {
  it('accepts a matched scene', () => {
    expect(
      AssetMatchCollectionSchema.safeParse({
        schemaVersion: '1.0.0',
        matchVersion: 1,
        projectId: 'project-1',
        generatedAt: NOW,
        inputFingerprint: 'fp',
        matches: [
          {
            sceneId: 'scene-01',
            requiredDurationMs: 5_000,
            candidates: [{ assetId: 'asset-1', score: 0.8, reasons: ['标签匹配'] }],
            selected: { assetId: 'asset-1', sourceStartMs: 0, sourceEndMs: 5_000 },
            status: 'matched',
            issues: [],
          },
        ],
        unmatchedSceneIds: [],
        issues: [],
      }).success,
    ).toBe(true);
  });
});

describe('validation report', () => {
  it('accepts a passed report without errors', () => {
    expect(
      ValidationReportSchema.safeParse({
        schemaVersion: '1.0.0',
        reportVersion: 1,
        projectId: 'project-1',
        validatedRevision: 1,
        passed: true,
        errors: [],
        warnings: [],
        validatedAt: NOW,
      }).success,
    ).toBe(true);
  });

  it('rejects inconsistent passed/errors combinations', () => {
    expect(
      ValidationReportSchema.safeParse({
        schemaVersion: '1.0.0',
        reportVersion: 1,
        projectId: 'project-1',
        validatedRevision: 1,
        passed: false,
        errors: [],
        warnings: [],
        validatedAt: NOW,
      }).success,
    ).toBe(false);
  });
});

describe('saved project and run events', () => {
  it('accepts a saved project ref', () => {
    expect(
      SavedProjectRefSchema.safeParse({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        runId: 'run-1',
        savedProjectPath: 'C:/projects/project-1/project.json',
        contentRevision: 1,
        contentFingerprint: 'fp',
        savedAt: NOW,
      }).success,
    ).toBe(true);
  });

  it('accepts a run event and rejects zero sequence numbers', () => {
    const event = {
      schemaVersion: '1.0.0',
      runId: 'run-1',
      projectId: 'project-1',
      seq: 1,
      type: 'run.started',
      timestamp: NOW,
    };

    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...event, seq: 0 }).success).toBe(false);
  });
});

describe('workflow state', () => {
  it('accepts an empty run state', () => {
    expect(
      WorkflowStateSchema.safeParse({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        runId: 'run-1',
        contentRevision: 0,
        status: 'pending',
        phaseStatus: {
          prepare: 'pending',
          storyboard: 'pending',
          voice: 'pending',
          video: 'pending',
        },
        currentNodeId: null,
        refs: {
          creationInput: null,
          assetManifest: null,
          analyzedAssets: null,
          creativeBrief: null,
          productionSpec: null,
          scenePlan: null,
          voiceSegments: null,
          assetMatches: null,
          videoProject: null,
          validationReport: null,
          savedProjectRef: null,
        },
        a1ApprovalRef: null,
        a2ApprovalRef: null,
        a3ApprovalRef: null,
        briefFeedback: null,
        scenePlanFeedback: null,
        validationPassed: false,
        completedNodes: [],
        savedProjectPath: null,
        lastEventSeq: 0,
        errors: [],
      }).success,
    ).toBe(true);
  });
});
