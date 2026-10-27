import { describe, expect, it } from 'vitest';
import { createSelection, selectionReducer, type EditorSelection } from './selection';

const INITIAL: EditorSelection = createSelection('scene-1');

describe('selectionReducer', () => {
  it('selects a scene and clears the active clip', () => {
    const withClip = selectionReducer(INITIAL, {
      clipId: 'clip-video-1',
      kind: 'video',
      sceneId: 'scene-1',
      type: 'select-clip',
    });

    expect(selectionReducer(withClip, { sceneId: 'scene-2', type: 'select-scene' })).toEqual({
      clip: null,
      sceneId: 'scene-2',
    });
  });

  it('derives the scene when a video, voice or subtitle clip is selected', () => {
    for (const kind of ['video', 'voice', 'subtitle'] as const) {
      const state = selectionReducer(INITIAL, {
        clipId: `clip-${kind}`,
        kind,
        sceneId: 'scene-2',
        type: 'select-clip',
      });

      expect(state).toEqual({
        clip: { id: `clip-${kind}`, kind },
        sceneId: 'scene-2',
      });
    }
  });

  it('selects a music clip without changing the active scene', () => {
    const state = selectionReducer(INITIAL, {
      clipId: 'clip-music-1',
      kind: 'music',
      type: 'select-clip',
    });

    expect(state).toEqual({
      clip: { id: 'clip-music-1', kind: 'music' },
      sceneId: 'scene-1',
    });
  });

  it('keeps the scene when a non-music clip has no scene reference', () => {
    const state = selectionReducer(INITIAL, {
      clipId: 'clip-video-x',
      kind: 'video',
      type: 'select-clip',
    });

    expect(state.sceneId).toBe('scene-1');
  });

  it('does not reset selection when only the playhead moves', () => {
    const selected = selectionReducer(INITIAL, {
      clipId: 'clip-voice-1',
      kind: 'voice',
      sceneId: 'scene-1',
      type: 'select-clip',
    });

    expect(selectionReducer(selected, { type: 'playhead-moved' })).toBe(selected);
  });

  it('starts with no active clip', () => {
    expect(createSelection('scene-1')).toEqual({ clip: null, sceneId: 'scene-1' });
    expect(createSelection(null)).toEqual({ clip: null, sceneId: null });
  });
});
