import { describe, expect, it } from 'vitest';
import type {
  MusicClip,
  SubtitleClip,
  VideoClip,
  VideoProject,
  VoiceClip,
} from '@miaoma/video-project';
import {
  applyEdit,
  findInvariantViolations,
  MIN_CLIP_DURATION_MS,
  type EditAction,
  type EditResult,
} from './project-edit';
import { resolveMusicSourceSeconds } from './preview-media';
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

function musicTrackClips(project: VideoProject): MusicClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'music');
  return ((track?.clips ?? []) as MusicClip[]).slice().sort((a, b) => a.startMs - b.startMs);
}

/** 用给定音乐片段替换音乐轨；用于构造有空隙、两段音乐等编辑场景。 */
function withMusicClips(project: VideoProject, clips: MusicClip[]): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => (track.kind === 'music' ? { ...track, clips } : track)),
  };
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

  it('reports overlapping subtitles', () => {
    const project = createEditingProject();
    const overlapped: VideoProject = {
      ...project,
      tracks: project.tracks.map((track) => {
        if (track.kind !== 'subtitle') {
          return track;
        }

        return {
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === 'clip-subtitle-2' ? { ...clip, startMs: 1_000 } : clip,
          ),
        };
      }),
    };

    expect(findInvariantViolations(overlapped).map((violation) => violation.code)).toContain(
      'SUBTITLE_OVERLAP',
    );
  });

  it('reports a scene whose subtitleIds drift from the subtitle track', () => {
    const project = createEditingProject();
    const drifted: VideoProject = {
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === 'scene-1' ? { ...scene, subtitleIds: ['sub-1'] } : scene,
      ),
    };

    expect(findInvariantViolations(drifted).map((violation) => violation.code)).toContain(
      'SCENE_SUBTITLE_REFERENCE_MISMATCH',
    );
  });

  it('reports overlapping music clips, out-of-project clips and invalid source ranges', () => {
    const project = createEditingProject();
    const overlapped = withMusicClips(project, [
      {
        assetId: 'music-1',
        endMs: 6_000,
        id: 'clip-music-a',
        kind: 'music',
        sourceEndMs: 6_000,
        sourceStartMs: 0,
        startMs: 0,
      },
      {
        assetId: 'music-1',
        endMs: 12_000,
        id: 'clip-music-b',
        kind: 'music',
        sourceEndMs: 6_000,
        sourceStartMs: 0,
        startMs: 5_000,
      },
    ]);

    expect(findInvariantViolations(overlapped).map((violation) => violation.code)).toContain(
      'MUSIC_TRACK_OVERLAP',
    );

    const outOfProject = withMusicClips(project, [
      {
        assetId: 'music-1',
        endMs: 13_000,
        id: 'clip-music-1',
        kind: 'music',
        sourceEndMs: 12_000,
        sourceStartMs: 0,
        startMs: 0,
      },
    ]);

    expect(findInvariantViolations(outOfProject).map((violation) => violation.code)).toContain(
      'MUSIC_OUT_OF_PROJECT',
    );

    const sourceBeyondAsset = withMusicClips(project, [
      {
        assetId: 'music-1',
        endMs: 12_000,
        id: 'clip-music-1',
        kind: 'music',
        sourceEndMs: 13_000,
        sourceStartMs: 0,
        startMs: 0,
      },
    ]);

    expect(findInvariantViolations(sourceBeyondAsset).map((violation) => violation.code)).toContain(
      'MUSIC_SOURCE_RANGE_INVALID',
    );
  });
});

describe('applyEdit subtitle clips', () => {
  it('moves a subtitle inside its scene and keeps scene subtitle references intact', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { clipId: 'clip-subtitle-1', deltaMs: 500, type: 'move-subtitle-clip' }),
    );

    expect(subtitleTrackClips(result.project).map((clip) => clipSpan(clip))).toEqual([
      '1000-2000',
      '2000-3500',
      '4500-6000',
      '8000-10500',
    ]);
    expect(result.project.scenes.find((scene) => scene.id === 'scene-1')?.subtitleIds).toEqual([
      'sub-1',
      'sub-2',
    ]);
    expect(findInvariantViolations(result.project)).toEqual([]);
  });

  it('trims both subtitle edges without leaving the scene', () => {
    const project = createEditingProject();
    const trimmedStart = expectOk(
      edit(project, {
        clipId: 'clip-subtitle-2',
        deltaMs: 300,
        edge: 'start',
        type: 'trim-subtitle-clip',
      }),
    );
    const trimmedEnd = expectOk(
      edit(project, {
        clipId: 'clip-subtitle-1',
        deltaMs: 300,
        edge: 'end',
        type: 'trim-subtitle-clip',
      }),
    );

    expect(subtitleTrackClips(trimmedStart.project)[1]).toMatchObject({
      endMs: 3_500,
      startMs: 2_300,
    });
    expect(subtitleTrackClips(trimmedEnd.project)[0]).toMatchObject({ endMs: 1_800, startMs: 500 });
  });

  it('rejects moving or trimming a subtitle across its scene boundary', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, {
        clipId: 'clip-subtitle-1',
        deltaMs: 3_000,
        type: 'move-subtitle-clip',
      }),
      'EDIT_CLIP_OUT_OF_BOUNDS',
    );
    expectRejected(
      edit(project, {
        clipId: 'clip-subtitle-4',
        deltaMs: 2_000,
        edge: 'end',
        type: 'trim-subtitle-clip',
      }),
      'EDIT_CLIP_OUT_OF_BOUNDS',
    );
  });

  it('rejects subtitles that would overlap another cue or shrink below the minimum', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, {
        clipId: 'clip-subtitle-1',
        deltaMs: 1_000,
        type: 'move-subtitle-clip',
      }),
      'EDIT_CLIP_OVERLAP',
    );
    expectRejected(
      edit(project, {
        clipId: 'clip-subtitle-1',
        deltaMs: 600,
        edge: 'end',
        type: 'trim-subtitle-clip',
      }),
      'EDIT_CLIP_OVERLAP',
    );
    expectRejected(
      edit(project, {
        clipId: 'clip-subtitle-1',
        deltaMs: 1_000,
        edge: 'start',
        type: 'trim-subtitle-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );
  });

  it('deletes a subtitle and removes it from the scene subtitle references', () => {
    const project = createEditingProject();

    const result = expectOk(
      edit(project, { clipId: 'clip-subtitle-2', type: 'delete-subtitle-clip' }),
    );

    expect(subtitleTrackClips(result.project).map((clip) => clip.id)).toEqual([
      'clip-subtitle-1',
      'clip-subtitle-3',
      'clip-subtitle-4',
    ]);
    expect(result.project.scenes.find((scene) => scene.id === 'scene-1')?.subtitleIds).toEqual([
      'sub-1',
    ]);
    expect(findInvariantViolations(result.project)).toEqual([]);
  });

  it('reports unknown clips, no-op deltas and fractional deltas', () => {
    const project = createEditingProject();

    expectRejected(
      edit(project, { clipId: 'clip-missing', deltaMs: 100, type: 'move-subtitle-clip' }),
      'EDIT_CLIP_NOT_FOUND',
    );
    expectRejected(
      edit(project, {
        clipId: 'clip-subtitle-1',
        deltaMs: 0.5,
        type: 'move-subtitle-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );

    const unchanged = expectOk(
      edit(project, { clipId: 'clip-subtitle-1', deltaMs: 0, type: 'move-subtitle-clip' }),
    );

    expect(unchanged.changed).toBe(false);
    expect(unchanged.project).toBe(project);
    expect(MIN_CLIP_DURATION_MS).toBe(100);
  });
});

describe('applyEdit music clips', () => {
  const GAP_PROJECT = (): VideoProject =>
    withMusicClips(createEditingProject(), [
      {
        assetId: 'music-1',
        endMs: 5_000,
        id: 'clip-music-1',
        kind: 'music',
        sourceEndMs: 5_000,
        sourceStartMs: 0,
        startMs: 0,
      },
      {
        assetId: 'music-1',
        endMs: 12_000,
        id: 'clip-music-2',
        kind: 'music',
        sourceEndMs: 6_000,
        sourceStartMs: 0,
        startMs: 6_000,
      },
    ]);

  it('moves a music clip while keeping the gap around it', () => {
    const result = expectOk(
      edit(GAP_PROJECT(), { clipId: 'clip-music-2', deltaMs: -500, type: 'move-music-clip' }),
    );

    expect(musicTrackClips(result.project).map((clip) => clipSpan(clip))).toEqual([
      '0-5000',
      '5500-11500',
    ]);
    expect(findInvariantViolations(result.project)).toEqual([]);
  });

  it('rejects music that leaves the project or overlaps another music clip', () => {
    expectRejected(
      edit(GAP_PROJECT(), { clipId: 'clip-music-2', deltaMs: 100, type: 'move-music-clip' }),
      'EDIT_CLIP_OUT_OF_BOUNDS',
    );
    expectRejected(
      edit(GAP_PROJECT(), { clipId: 'clip-music-1', deltaMs: -100, type: 'move-music-clip' }),
      'EDIT_CLIP_OUT_OF_BOUNDS',
    );
    expectRejected(
      edit(GAP_PROJECT(), { clipId: 'clip-music-2', deltaMs: -1_500, type: 'move-music-clip' }),
      'EDIT_CLIP_OVERLAP',
    );
  });

  it('trims both music edges and keeps the source range in step', () => {
    const project = createEditingProject();
    const trimmedStart = expectOk(
      edit(project, {
        clipId: 'clip-music-1',
        deltaMs: 1_000,
        edge: 'start',
        type: 'trim-music-clip',
      }),
    );
    const trimmedEnd = expectOk(
      edit(trimmedStart.project, {
        clipId: 'clip-music-1',
        deltaMs: -1_000,
        edge: 'end',
        type: 'trim-music-clip',
      }),
    );

    expect(musicTrackClips(trimmedStart.project)[0]).toMatchObject({
      endMs: 12_000,
      sourceStartMs: 1_000,
      startMs: 1_000,
    });
    expect(musicTrackClips(trimmedEnd.project)[0]).toMatchObject({
      endMs: 11_000,
      sourceEndMs: 11_000,
      sourceStartMs: 1_000,
      startMs: 1_000,
    });
  });

  it('rejects trims that leave the asset or project range', () => {
    const shortAssetProject: VideoProject = {
      ...GAP_PROJECT(),
      assets: {
        ...createEditingProject().assets,
        music: [
          {
            artist: 'Mika Chen',
            durationMs: 6_000,
            id: 'music-1',
            path: '/media/song.mp3',
            title: 'Eutopia',
          },
        ],
      },
    };

    expectRejected(
      edit(shortAssetProject, {
        clipId: 'clip-music-1',
        deltaMs: 1_500,
        edge: 'end',
        type: 'trim-music-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );
    expectRejected(
      edit(createEditingProject(), {
        clipId: 'clip-music-1',
        deltaMs: 2_000,
        edge: 'end',
        type: 'trim-music-clip',
      }),
      'EDIT_CLIP_OUT_OF_BOUNDS',
    );
    expectRejected(
      edit(createEditingProject(), {
        clipId: 'clip-music-1',
        deltaMs: -100,
        edge: 'start',
        type: 'trim-music-clip',
      }),
      'EDIT_CLIP_OUT_OF_BOUNDS',
    );
    expectRejected(
      edit(GAP_PROJECT(), {
        clipId: 'clip-music-2',
        deltaMs: -100,
        edge: 'start',
        type: 'trim-music-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );
    expectRejected(
      edit(createEditingProject(), {
        clipId: 'clip-music-1',
        deltaMs: -11_950,
        edge: 'end',
        type: 'trim-music-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );
  });

  it('splits a non-loop music clip into contiguous source ranges', () => {
    const result = expectOk(
      edit(createEditingProject(), {
        atMs: 6_000,
        clipId: 'clip-music-1',
        type: 'split-music-clip',
      }),
    );
    const clips = musicTrackClips(result.project);

    expect(clips.map((clip) => clipSpan(clip))).toEqual(['0-6000', '6000-12000']);
    expect(clips.map((clip) => `${clip.sourceStartMs}-${clip.sourceEndMs}`)).toEqual([
      '0-6000',
      '6000-12000',
    ]);
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(2);
    expect(findInvariantViolations(result.project)).toEqual([]);
  });

  it('splits a looping clip so both sides keep the loop phase continuous', () => {
    const project = withMusicClips(createEditingProject(), [
      {
        assetId: 'music-1',
        endMs: 12_000,
        id: 'clip-music-1',
        kind: 'music',
        loop: true,
        sourceEndMs: 9_000,
        sourceStartMs: 5_000,
        startMs: 0,
      },
    ]);

    const result = expectOk(
      edit(project, { atMs: 5_000, clipId: 'clip-music-1', type: 'split-music-clip' }),
    );
    const [left, right] = musicTrackClips(result.project);

    expect(left).toMatchObject({ endMs: 5_000, loop: true, sourceStartMs: 5_000, startMs: 0 });
    // 5s 处在 4s 循环窗口里的相位是 6s：右段从 6s 开始，保证分割瞬间不断音。
    expect(right).toMatchObject({
      loop: true,
      sourceEndMs: 9_000,
      sourceStartMs: 6_000,
      startMs: 5_000,
    });
    expect(resolveMusicSourceSeconds(left!, 4.999)).toBeCloseTo(5.999, 2);
    expect(resolveMusicSourceSeconds(right!, 5.001)).toBeCloseTo(6.001, 2);
  });

  it('rejects splits too close to either edge or beyond the trimmed audio range', () => {
    expectRejected(
      edit(createEditingProject(), {
        atMs: 50,
        clipId: 'clip-music-1',
        type: 'split-music-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );
    expectRejected(
      edit(createEditingProject(), {
        atMs: 11_950,
        clipId: 'clip-music-1',
        type: 'split-music-clip',
      }),
      'EDIT_INVALID_CLIP_RANGE',
    );

    const shortSource = withMusicClips(createEditingProject(), [
      {
        assetId: 'music-1',
        endMs: 12_000,
        id: 'clip-music-1',
        kind: 'music',
        loop: false,
        sourceEndMs: 8_000,
        sourceStartMs: 0,
        startMs: 0,
      },
    ]);

    expectRejected(
      edit(shortSource, { atMs: 9_000, clipId: 'clip-music-1', type: 'split-music-clip' }),
      'EDIT_INVALID_CLIP_RANGE',
    );
  });

  it('keeps clip ids unique when a split result is split again', () => {
    const first = expectOk(
      edit(createEditingProject(), {
        atMs: 3_000,
        clipId: 'clip-music-1',
        type: 'split-music-clip',
      }),
    );
    const rightId = musicTrackClips(first.project)[1]?.id ?? '';

    const second = expectOk(
      edit(first.project, { atMs: 6_000, clipId: rightId, type: 'split-music-clip' }),
    );

    expect(new Set(musicTrackClips(second.project).map((clip) => clip.id)).size).toBe(3);
  });

  it('deletes a music clip and leaves an empty music track', () => {
    const result = expectOk(
      edit(createEditingProject(), { clipId: 'clip-music-1', type: 'delete-music-clip' }),
    );

    expect(musicTrackClips(result.project)).toEqual([]);
    expect(findInvariantViolations(result.project)).toEqual([]);
  });

  it('reports unknown music clips', () => {
    expectRejected(
      edit(createEditingProject(), { clipId: 'clip-missing', type: 'delete-music-clip' }),
      'EDIT_CLIP_NOT_FOUND',
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
