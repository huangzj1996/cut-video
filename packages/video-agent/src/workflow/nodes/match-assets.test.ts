import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AnalyzedAssetCollectionSchema,
  ScenePlanSchema,
  VoiceSegmentCollectionSchema,
} from '@miaoma/video-project';
import { matchAssets } from './match-assets';
import { createNodeFixture, type NodeFixture } from './test-support/node-fixture';

const NOW = '2026-10-24T00:00:00.000Z';

describe('matchAssets', () => {
  let fixture: NodeFixture;

  beforeEach(async () => {
    fixture = await createNodeFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function input(overrides: Record<string, unknown> = {}) {
    return {
      projectId: fixture.projectId,
      scenePlan: fixture.scenePlan,
      voiceSegments: fixture.voiceSegments,
      analyzedAssets: fixture.analysis,
      previousMatchVersion: 0,
      ...overrides,
    };
  }

  it('matches a scene with a long enough asset', () => {
    const result = matchAssets(input(), NOW);

    expect(result.matches[0]?.status).toBe('matched');
    expect(result.matches[0]?.selected).toEqual({
      assetId: 'asset-1',
      sourceStartMs: 0,
      sourceEndMs: 5_000,
    });
    expect(result.issues).toEqual([]);
    expect(result.unmatchedSceneIds).toEqual([]);
  });

  it('marks scenes unmatched when no assets exist', () => {
    const emptyAnalysis = AnalyzedAssetCollectionSchema.parse({
      ...fixture.analysis,
      assets: [],
    });
    const result = matchAssets(input({ analyzedAssets: emptyAnalysis }), NOW);

    expect(result.matches[0]?.status).toBe('unmatched');
    expect(result.unmatchedSceneIds).toEqual(['scene-01']);
    expect(result.issues[0]?.code).toBe('NO_VIDEO_MATERIAL');
  });

  it('marks coverage shortfall without stretching the source', () => {
    const shortAnalysis = AnalyzedAssetCollectionSchema.parse({
      ...fixture.analysis,
      assets: [{ ...fixture.analysis.assets[0], durationMs: 2_000 }],
    });
    const result = matchAssets(input({ analyzedAssets: shortAnalysis }), NOW);

    expect(result.matches[0]?.status).toBe('partial');
    expect(result.matches[0]?.selected?.sourceEndMs).toBe(2_000);
    expect(result.matches[0]?.issues.some((issue) => issue.code === 'COVERAGE_SHORTFALL')).toBe(
      true,
    );
  });

  it('allocates non-overlapping windows and reuses only when necessary', () => {
    const twoScenePlan = ScenePlanSchema.parse({
      ...fixture.scenePlan,
      scenes: [
        fixture.scenePlan.scenes[0],
        {
          ...fixture.scenePlan.scenes[0],
          id: 'scene-02',
          index: 2,
          title: '第二个分镜',
        },
        {
          ...fixture.scenePlan.scenes[0],
          id: 'scene-03',
          index: 3,
          title: '第三个分镜',
        },
      ],
    });
    const voices = VoiceSegmentCollectionSchema.parse({
      ...fixture.voiceSegments,
      segments: [1, 2, 3].map((index) => ({
        ...fixture.voiceSegments.segments[0],
        segmentId: `voice-scene-0${index}`,
        sceneId: `scene-0${index}`,
        assetId: `voice-scene-0${index}`,
        subtitles: [
          {
            id: `cue-scene-0${index}-1`,
            text: '测试旁白。',
            startMs: 0,
            endMs: 5_000,
          },
        ],
      })),
    });
    const result = matchAssets(input({ scenePlan: twoScenePlan, voiceSegments: voices }), NOW);

    expect(result.matches[0]?.selected?.sourceStartMs).toBe(0);
    expect(result.matches[1]?.selected?.sourceStartMs).toBe(5_000);
    expect(result.matches[2]?.status).toBe('partial');
    expect(result.matches[2]?.issues.some((issue) => issue.code === 'REUSED_ASSET')).toBe(true);
  });
});
