import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VideoClip, VideoProject, VoiceClip } from '@miaoma/video-project';
import { assembleTimeline } from './assemble-timeline';
import { createNodeFixture, type NodeFixture } from './test-support/node-fixture';
import { validateProject } from './validate-project';

const NOW = '2026-10-24T00:00:00.000Z';
const RUN_ID = 'run-1';

function videoClips(project: VideoProject): VideoClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'video');
  return track?.kind === 'video' ? track.clips : [];
}

function voiceClips(project: VideoProject): VoiceClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'voice');
  return track?.kind === 'voice' ? track.clips : [];
}

/**
 * 模拟编辑器延长分镜后的工程：分镜和视频片段一起变长，配音片段可选跟随。
 * `extendVoice=false` 时保留配音原长度，用于验证旧错误规则仍然生效。
 */
function extendFirstScene(project: VideoProject, durationMs: number): VideoProject {
  const next = structuredClone(project);
  const scene = next.scenes[0];

  if (!scene) {
    throw new Error('fixture project has no scene');
  }

  scene.durationMs = durationMs;

  for (const clip of videoClips(next)) {
    clip.endMs = durationMs;
    clip.sourceEndMs = durationMs;
  }

  return next;
}

describe('validateProject voice clip length', () => {
  let fixture: NodeFixture;

  beforeEach(async () => {
    fixture = await createNodeFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function buildProject(): VideoProject {
    return assembleTimeline(
      {
        projectId: fixture.projectId,
        scenePlan: fixture.scenePlan,
        voiceSegments: fixture.voiceSegments,
        matches: fixture.matches,
        analysis: fixture.analysis,
        spec: fixture.spec,
        project: fixture.project,
      },
      RUN_ID,
      NOW,
    ).project;
  }

  it('reports a voice clip longer than its audio as a warning so the scene can hold a silent tail', () => {
    const project = extendFirstScene(buildProject(), 7_000);

    for (const clip of voiceClips(project)) {
      clip.endMs = 7_000;
    }

    const report = validateProject(project, NOW);

    expect(report.errors).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        code: 'VOICE_CLIP_TOO_LONG',
        severity: 'warning',
        clipId: 'clip-voice-scene-01',
      }),
    ]);
  });

  it('still fails the report when the voice track does not end with the project duration', () => {
    const project = extendFirstScene(buildProject(), 7_000);
    const report = validateProject(project, NOW);

    expect(report.passed).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain('VOICE_TRACK_END_MISMATCH');
  });

  it('still fails the report when the voice track has a gap', () => {
    const project = extendFirstScene(buildProject(), 7_000);

    for (const clip of voiceClips(project)) {
      clip.endMs = 7_000;
    }

    const [firstVoice] = voiceClips(project);

    if (!firstVoice) {
      throw new Error('fixture project has no voice clip');
    }

    const voiceTrack = project.tracks.find((candidate) => candidate.kind === 'voice');

    if (!voiceTrack || voiceTrack.kind !== 'voice') {
      throw new Error('fixture project has no voice track');
    }

    voiceTrack.clips = [
      { ...firstVoice, endMs: 3_000 },
      { ...firstVoice, endMs: 7_000, id: 'voice-scene-01-b', startMs: 4_000 },
    ];

    const report = validateProject(project, NOW);

    expect(report.passed).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain('VOICE_TRACK_GAP');
  });
});
