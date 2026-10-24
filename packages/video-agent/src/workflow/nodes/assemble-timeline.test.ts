import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateProject } from './validate-project';
import { assembleTimeline } from './assemble-timeline';
import { createNodeFixture, type NodeFixture } from './test-support/node-fixture';

const NOW = '2026-10-24T00:00:00.000Z';
const RUN_ID = 'run-1';

describe('assembleTimeline + validateProject', () => {
  let fixture: NodeFixture;

  beforeEach(async () => {
    fixture = await createNodeFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function buildInput() {
    return {
      projectId: fixture.projectId,
      scenePlan: fixture.scenePlan,
      voiceSegments: fixture.voiceSegments,
      matches: fixture.matches,
      analysis: fixture.analysis,
      spec: fixture.spec,
      project: fixture.project,
    };
  }

  it('builds four tracks and a passing validation report', () => {
    const { project, durationMs } = assembleTimeline(buildInput(), RUN_ID, NOW);
    const report = validateProject(project, NOW);

    expect(durationMs).toBe(5_000);
    expect(project.ai.runId).toBe(RUN_ID);
    expect(project.project.contentRevision).toBe(1);
    expect(project.scenes).toHaveLength(1);
    expect(project.scenes[0]).toMatchObject({
      id: 'scene-01',
      durationMs: 5_000,
      voiceAssetId: 'voice-scene-01',
      matchedVideoAssetIds: ['asset-1'],
    });
    expect(project.tracks.map((track) => track.kind).sort()).toEqual([
      'music',
      'subtitle',
      'video',
      'voice',
    ]);
    expect(report.passed).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('reports missing video clips', () => {
    const { project } = assembleTimeline(buildInput(), RUN_ID, NOW);
    const broken = structuredClone(project);

    for (const track of broken.tracks) {
      if (track.kind === 'video') {
        track.clips = [];
      }
    }

    const report = validateProject(broken, NOW);

    expect(report.passed).toBe(false);
    expect(report.errors.some((error) => error.code === 'NO_VIDEO_CLIPS')).toBe(true);
  });

  it('reports out-of-range source clips', () => {
    const { project } = assembleTimeline(buildInput(), RUN_ID, NOW);
    const broken = structuredClone(project);
    const videoTrack = broken.tracks.find((track) => track.kind === 'video');

    if (videoTrack?.kind === 'video') {
      videoTrack.clips[0]!.sourceEndMs = 20_000;
    }

    const report = validateProject(broken, NOW);

    expect(report.errors.some((error) => error.code === 'SOURCE_RANGE_INVALID')).toBe(true);
  });

  it('reports missing asset files', () => {
    const { project } = assembleTimeline(buildInput(), RUN_ID, NOW);
    rmSync(fixture.videoPath, { force: true });

    const report = validateProject(project, NOW);

    expect(report.errors.some((error) => error.code === 'ASSET_FILE_MISSING')).toBe(true);
  });

  it('reports overlapping subtitles', () => {
    const { project } = assembleTimeline(buildInput(), RUN_ID, NOW);
    const broken = structuredClone(project);
    const subtitleTrack = broken.tracks.find((track) => track.kind === 'subtitle');

    if (subtitleTrack?.kind === 'subtitle') {
      subtitleTrack.clips.push({
        ...subtitleTrack.clips[0]!,
        id: 'clip-sub-overlap',
      });
    }

    const report = validateProject(broken, NOW);

    expect(report.errors.some((error) => error.code === 'SUBTITLE_TRACK_OVERLAP')).toBe(true);
  });
});
