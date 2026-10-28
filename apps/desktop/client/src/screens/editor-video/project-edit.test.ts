import { describe, expect, it } from 'vitest';
import type { SubtitleClip, VideoClip, VideoProject, VoiceClip } from '@miaoma/video-project';
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

function subtitleTrackClips(project: VideoProject): SubtitleClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'subtitle');
  return ((track?.clips ?? []) as SubtitleClip[]).slice().sort((a, b) => a.startMs - b.startMs);
}

function sceneDuration(project: VideoProject, sceneId: string): number | undefined {
  return project.scenes.find((scene) => scene.id === sceneId)?.durationMs;
}

function totalSceneMs(project: VideoProject): number {
  return project.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
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

describe('applyEdit trim-video', () => {
  it('shortens a scene and pulls the later scenes forward with their tracks', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { clipId: 'clip-video-1', deltaMs: -2_800, type: 'trim-video' }),
    );

    expect(result.changed).toBe(true);
    expect(sceneDuration(result.project, 'scene-1')).toBe(1_200);
    expect(
      videoTrackClips(result.project).map((clip) => `${clip.sceneId} ${clipSpan(clip)}`),
    ).toEqual(['scene-1 0-1200', 'scene-2 1200-4200', 'scene-3 4200-9200']);
    expect(videoTrackClips(result.project)[0]?.sourceEndMs).toBe(1_200);
    expect(
      voiceTrackClips(result.project).map((clip) => `${clip.sceneId} ${clipSpan(clip)}`),
    ).toEqual(['scene-1 0-1200', 'scene-2 1200-4200', 'scene-3 4200-9200']);
    expect(
      subtitleTrackClips(result.project).map((clip) => `${clip.id} ${clipSpan(clip)}`),
    ).toEqual([
      'clip-subtitle-1 500-1200',
      'clip-subtitle-3 1700-3200',
      'clip-subtitle-4 5200-7700',
    ]);
    expect(findInvariantViolations(result.project)).toEqual([]);
    expect(voiceTrackClips(result.project).at(-1)?.endMs).toBe(totalSceneMs(result.project));
  });

  it('truncates the voice clip and its subtitles when the last scene is shortened', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { clipId: 'clip-video-3', deltaMs: -2_000, type: 'trim-video' }),
    );

    expect(sceneDuration(result.project, 'scene-3')).toBe(3_000);
    expect(videoTrackClips(result.project).map((clip) => clipSpan(clip))).toEqual([
      '0-4000',
      '4000-7000',
      '7000-10000',
    ]);
    expect(voiceTrackClips(result.project).map((clip) => clipSpan(clip))).toEqual([
      '0-4000',
      '4000-7000',
      '7000-10000',
    ]);
    expect(
      subtitleTrackClips(result.project).map((clip) => `${clip.id} ${clipSpan(clip)}`),
    ).toContain('clip-subtitle-4 8000-10000');
    expect(findInvariantViolations(result.project)).toEqual([]);
    expect(voiceTrackClips(result.project).at(-1)?.endMs).toBe(totalSceneMs(result.project));
  });

  it('extends a scene when the source video still has footage', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { clipId: 'clip-video-1', deltaMs: 1_000, type: 'trim-video' }),
    );

    expect(sceneDuration(result.project, 'scene-1')).toBe(5_000);
    expect(
      videoTrackClips(result.project).map((clip) => `${clip.sceneId} ${clipSpan(clip)}`),
    ).toEqual(['scene-1 0-5000', 'scene-2 5000-8000', 'scene-3 8000-13000']);
    expect(videoTrackClips(result.project)[0]?.sourceEndMs).toBe(5_000);
    expect(voiceTrackClips(result.project).map((clip) => clipSpan(clip))).toEqual([
      '0-5000',
      '5000-8000',
      '8000-13000',
    ]);
    expect(
      subtitleTrackClips(result.project).map((clip) => `${clip.id} ${clipSpan(clip)}`),
    ).toEqual([
      'clip-subtitle-1 500-1500',
      'clip-subtitle-2 2000-3500',
      'clip-subtitle-3 5500-7000',
      'clip-subtitle-4 9000-11500',
    ]);
    expect(findInvariantViolations(result.project)).toEqual([]);
    expect(voiceTrackClips(result.project).at(-1)?.endMs).toBe(totalSceneMs(result.project));
  });

  it('rejects extending past the end of the source video without touching the document', () => {
    const project = createEditingProject();
    const before = structuredClone(project);

    expectRejected(
      edit(project, { clipId: 'clip-video-1', deltaMs: 7_000, type: 'trim-video' }),
      'EDIT_SOURCE_RANGE_EXCEEDED',
    );
    expect(project).toEqual(before);
  });

  it('only lets the trailing video clip of a scene move the scene end', () => {
    const project = createEditingProject();

    const split = expectOk(edit(project, { atMs: 2_000, type: 'split-video' }));
    const firstClip = videoTrackClips(split.project)[0];

    expect(firstClip?.id).toBe('clip-video-1');

    expectRejected(
      edit(split.project, { clipId: firstClip?.id ?? '', deltaMs: 500, type: 'trim-video' }),
      'EDIT_TRIM_NOT_LAST_CLIP',
    );
  });

  it('rejects a trim that would collapse the scene or is not a whole millisecond delta', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, { clipId: 'clip-video-1', deltaMs: -4_000, type: 'trim-video' }),
      'EDIT_TRIM_SCENE_TOO_SHORT',
    );
    expectRejected(
      edit(project, { clipId: 'clip-video-1', deltaMs: 0, type: 'trim-video' }),
      'EDIT_TRIM_INVALID_DELTA',
    );
    expectRejected(
      edit(project, { clipId: 'clip-video-1', deltaMs: 12.5, type: 'trim-video' }),
      'EDIT_TRIM_INVALID_DELTA',
    );
    expectRejected(
      edit(project, { clipId: 'clip-missing', deltaMs: 500, type: 'trim-video' }),
      'EDIT_CLIP_NOT_FOUND',
    );
  });

  it('rejects the trim when the document already breaks the timeline invariants', () => {
    const project = createEditingProject();
    const broken: VideoProject = {
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === 'scene-3' ? { ...scene, durationMs: scene.durationMs + 500 } : scene,
      ),
    };

    expectRejected(
      edit(broken, { clipId: 'clip-video-1', deltaMs: -500, type: 'trim-video' }),
      'EDIT_INVARIANT_VIOLATION',
    );
  });
});

describe('applyEdit split-video', () => {
  it('splits the video clip under the playhead into two source-contiguous clips', () => {
    const project = createEditingProject();

    const result = expectOk(edit(project, { atMs: 2_000, type: 'split-video' }));
    const videoClips = videoTrackClips(result.project);

    expect(result.changed).toBe(true);
    expect(videoClips).toHaveLength(4);
    expect(
      videoClips.map(
        (clip) => `${clip.sceneId} ${clipSpan(clip)} src ${clip.sourceStartMs}-${clip.sourceEndMs}`,
      ),
    ).toEqual([
      'scene-1 0-2000 src 0-2000',
      'scene-1 2000-4000 src 2000-4000',
      'scene-2 4000-7000 src 0-3000',
      'scene-3 7000-12000 src 0-5000',
    ]);
    expect(result.project.scenes.map((scene) => scene.durationMs)).toEqual([4_000, 3_000, 5_000]);
    expect(findInvariantViolations(result.project)).toEqual([]);
    expect(voiceTrackClips(result.project).map((clip) => clipSpan(clip))).toEqual([
      '0-4000',
      '4000-7000',
      '7000-12000',
    ]);
  });

  it('keeps splitting the same scene into unique clip ids with contiguous source ranges', () => {
    const project = createEditingProject();

    const first = expectOk(edit(project, { atMs: 1_000, type: 'split-video' }));
    const second = expectOk(edit(first.project, { atMs: 3_000, type: 'split-video' }));
    const sceneOne = videoTrackClips(second.project).filter((clip) => clip.sceneId === 'scene-1');

    expect(sceneOne.map((clip) => clipSpan(clip))).toEqual(['0-1000', '1000-3000', '3000-4000']);
    expect(sceneOne.map((clip) => `${clip.sourceStartMs}-${clip.sourceEndMs}`)).toEqual([
      '0-1000',
      '1000-3000',
      '3000-4000',
    ]);
    expect(new Set(sceneOne.map((clip) => clip.id)).size).toBe(3);
    expect(findInvariantViolations(second.project)).toEqual([]);
  });

  it('rejects a split outside any video clip without touching the document', () => {
    const project = createEditingProject();
    const before = structuredClone(project);

    expectRejected(edit(project, { atMs: 0, type: 'split-video' }), 'EDIT_SPLIT_OUTSIDE_CLIP');
    expectRejected(edit(project, { atMs: 4_000, type: 'split-video' }), 'EDIT_SPLIT_OUTSIDE_CLIP');
    expectRejected(edit(project, { atMs: 13_000, type: 'split-video' }), 'EDIT_SPLIT_OUTSIDE_CLIP');
    expect(project).toEqual(before);
  });
});

describe('applyEdit blocked structural edits', () => {
  it('blocks deleting video and voice clips with a pointer back to the creation page', () => {
    const project = createEditingProject();
    const before = structuredClone(project);
    const videoResult = edit(project, { clipId: 'clip-video-1', type: 'delete-clip' });
    const voiceResult = edit(project, { clipId: 'clip-voice-1', type: 'delete-clip' });

    expectRejected(videoResult, 'EDIT_DELETE_BLOCKED');
    expectRejected(voiceResult, 'EDIT_DELETE_BLOCKED');

    if (!videoResult.ok && !voiceResult.ok) {
      expect(videoResult.message).toContain('创作消息页');
      expect(voiceResult.message).toContain('创作消息页');
    }

    expect(project).toEqual(before);
  });

  it('blocks adding and removing scenes', () => {
    const project = createEditingProject();

    expectRejected(edit(project, { type: 'add-scene' }), 'EDIT_SCENE_ADD_BLOCKED');
    expectRejected(
      edit(project, { sceneId: 'scene-2', type: 'remove-scene' }),
      'EDIT_SCENE_REMOVE_BLOCKED',
    );
  });

  it('blocks replacing the asset behind a clip', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, { assetId: 'video-2', clipId: 'clip-video-1', type: 'replace-asset' }),
      'EDIT_ASSET_REPLACE_BLOCKED',
    );
  });

  it('reports a missing clip when trying to delete an unknown clip', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, { clipId: 'clip-missing', type: 'delete-clip' }),
      'EDIT_CLIP_NOT_FOUND',
    );
  });
});
