import { describe, expect, it } from 'vitest';
import type { VideoClip, VideoProject, VoiceClip } from '@miaoma/video-project';
import {
  applyEdit,
  findInvariantViolations,
  type EditAction,
  type EditResult,
} from './project-edit';
import { createEditingProject } from './test-support/editing-project';

function videoTrackClips(project: VideoProject): VideoClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'video');
  return ((track?.clips ?? []) as VideoClip[]).slice().sort((a, b) => a.startMs - b.startMs);
}

function voiceTrackClips(project: VideoProject): VoiceClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'voice');
  return ((track?.clips ?? []) as VoiceClip[]).slice().sort((a, b) => a.startMs - b.startMs);
}

function clipSpan(clip: { endMs: number; startMs: number }): string {
  return `${clip.startMs}-${clip.endMs}`;
}

function edit(project: VideoProject, action: EditAction): EditResult {
  return applyEdit(project, action);
}

function expectOk(result: EditResult): Extract<EditResult, { ok: true }> {
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result;
}

function expectRejected(result: EditResult, code: string): void {
  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error('expected edit to be rejected');
  }

  expect(result.code).toBe(code);
}

describe('applyEdit reorder-scene', () => {
  it('moves the last scene to the front and shifts video, voice and subtitle clips together', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-3', targetIndex: 0 }),
    );

    expect(result.changed).toBe(true);
    expect(result.project.scenes.map((scene) => `${scene.id}:${scene.index}`)).toEqual([
      'scene-3:1',
      'scene-1:2',
      'scene-2:3',
    ]);
    expect(
      videoTrackClips(result.project).map((clip) => `${clip.sceneId} ${clipSpan(clip)}`),
    ).toEqual(['scene-3 0-5000', 'scene-1 5000-9000', 'scene-2 9000-12000']);
    expect(
      voiceTrackClips(result.project).map((clip) => `${clip.sceneId} ${clipSpan(clip)}`),
    ).toEqual(['scene-3 0-5000', 'scene-1 5000-9000', 'scene-2 9000-12000']);
    const subtitleTrack = result.project.tracks.find((track) => track.kind === 'subtitle');

    expect(subtitleTrack?.clips.map((clip) => clipSpan(clip))).toEqual([
      '1000-3500',
      '5500-6500',
      '7000-8500',
      '9500-11000',
    ]);
  });

  it('moves the first scene to the end and renumbers the remaining scenes', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-1', targetIndex: 2 }),
    );

    expect(result.project.scenes.map((scene) => `${scene.id}:${scene.index}`)).toEqual([
      'scene-2:1',
      'scene-3:2',
      'scene-1:3',
    ]);
    expect(
      videoTrackClips(result.project).map((clip) => `${clip.sceneId} ${clipSpan(clip)}`),
    ).toEqual(['scene-2 0-3000', 'scene-3 3000-8000', 'scene-1 8000-12000']);
  });

  it('swaps middle scenes without leaving gaps or overlaps on the video track', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-2', targetIndex: 2 }),
    );
    const videoClips = videoTrackClips(result.project);

    expect(videoClips.map((clip) => clip.sceneId)).toEqual(['scene-1', 'scene-3', 'scene-2']);
    expect(videoClips[0]?.startMs).toBe(0);
    expect(videoClips[1]?.startMs).toBe(videoClips[0]?.endMs);
    expect(videoClips[2]?.startMs).toBe(videoClips[1]?.endMs);
    expect(videoClips[2]?.endMs).toBe(12_000);
  });

  it('keeps the music track untouched when scenes are reordered', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-3', targetIndex: 0 }),
    );
    const musicBefore = project.tracks.find((track) => track.kind === 'music');
    const musicAfter = result.project.tracks.find((track) => track.kind === 'music');

    expect(musicAfter).toEqual(musicBefore);
  });

  it('does not report a change when a scene is dropped back onto its own position', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-2', targetIndex: 1 }),
    );

    expect(result.changed).toBe(false);
    expect(result.project).toBe(project);
  });

  it('rejects an unknown scene id without touching the document', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-x', targetIndex: 0 }),
      'EDIT_SCENE_NOT_FOUND',
    );
  });

  it('rejects an out-of-range or fractional target index', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-1', targetIndex: 3 }),
      'EDIT_INVALID_TARGET_INDEX',
    );
    expectRejected(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-1', targetIndex: -1 }),
      'EDIT_INVALID_TARGET_INDEX',
    );
    expectRejected(
      edit(project, { type: 'reorder-scene', sceneId: 'scene-1', targetIndex: 0.5 }),
      'EDIT_INVALID_TARGET_INDEX',
    );
  });

  it('rejects the edit when the timeline invariants do not hold afterwards', () => {
    const project = createEditingProject();
    const brokenVideoTrack = {
      ...project.tracks.find((track) => track.kind === 'video')!,
    };

    brokenVideoTrack.clips = brokenVideoTrack.clips.filter((clip) => clip.sceneId !== 'scene-2');

    const broken: VideoProject = {
      ...project,
      tracks: project.tracks.map((track) => (track.kind === 'video' ? brokenVideoTrack : track)),
    };

    expectRejected(
      edit(broken, { type: 'reorder-scene', sceneId: 'scene-1', targetIndex: 2 }),
      'EDIT_INVARIANT_VIOLATION',
    );
  });
});

describe('findInvariantViolations', () => {
  it('returns no violations for the generated project shape', () => {
    expect(findInvariantViolations(createEditingProject())).toEqual([]);
  });

  it('reports a gap on the video track', () => {
    const project = createEditingProject();
    const withGap: VideoProject = {
      ...project,
      tracks: project.tracks.map((track) => {
        if (track.kind !== 'video') {
          return track;
        }

        return {
          ...track,
          clips: track.clips.map((clip) =>
            clip.sceneId === 'scene-2'
              ? { ...clip, startMs: clip.startMs + 100, endMs: clip.endMs + 100 }
              : clip,
          ),
        };
      }),
    };

    expect(findInvariantViolations(withGap).map((violation) => violation.code)).toContain(
      'VIDEO_TRACK_GAP_OR_OVERLAP',
    );
  });

  it('reports a subtitle clip that escapes its scene', () => {
    const project = createEditingProject();
    const escaped: VideoProject = {
      ...project,
      tracks: project.tracks.map((track) => {
        if (track.kind !== 'subtitle') {
          return track;
        }

        return {
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === 'clip-subtitle-1' ? { ...clip, endMs: 5_000 } : clip,
          ),
        };
      }),
    };

    expect(findInvariantViolations(escaped).map((violation) => violation.code)).toContain(
      'SUBTITLE_OUT_OF_SCENE',
    );
  });

  it('reports a voice track that does not end with the project', () => {
    const project = createEditingProject();
    const shortened: VideoProject = {
      ...project,
      tracks: project.tracks.map((track) => {
        if (track.kind !== 'voice') {
          return track;
        }

        return {
          ...track,
          clips: track.clips.map((clip) =>
            clip.sceneId === 'scene-3' ? { ...clip, endMs: clip.endMs - 500 } : clip,
          ),
        };
      }),
    };

    expect(findInvariantViolations(shortened).map((violation) => violation.code)).toContain(
      'VOICE_TRACK_DURATION_MISMATCH',
    );
  });

  it('reports duplicate scene indexes', () => {
    const project = createEditingProject();
    const duplicated: VideoProject = {
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === 'scene-2' ? { ...scene, index: 1 } : scene,
      ),
    };

    expect(findInvariantViolations(duplicated).map((violation) => violation.code)).toContain(
      'SCENE_INDEX_MISMATCH',
    );
  });

  it('reports clips that reference a scene which no longer exists', () => {
    const project = createEditingProject();
    const orphaned: VideoProject = {
      ...project,
      tracks: project.tracks.map((track) => {
        if (track.kind !== 'video') {
          return track;
        }

        return {
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === 'clip-video-1' ? { ...clip, sceneId: 'scene-missing' } : clip,
          ),
        };
      }),
    };

    expect(findInvariantViolations(orphaned).map((violation) => violation.code)).toContain(
      'SCENE_REFERENCE_MISMATCH',
    );
  });
});
