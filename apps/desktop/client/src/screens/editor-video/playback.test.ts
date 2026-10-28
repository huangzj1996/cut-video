import { describe, expect, it } from 'vitest';
import {
  advancePosition,
  createAnchor,
  createPlaybackState,
  DRIFT_THRESHOLD_SECONDS,
  needsDriftCorrection,
  parseTimecode,
  playbackReducer,
} from './playback';

const DURATION = 10;

describe('playbackReducer', () => {
  it('starts paused at zero', () => {
    expect(createPlaybackState()).toEqual({ positionSeconds: 0, status: 'paused' });
  });

  it('plays, pauses, and toggles without losing the position', () => {
    let state = playbackReducer(createPlaybackState(), {
      durationSeconds: DURATION,
      type: 'play',
    });

    expect(state).toEqual({ positionSeconds: 0, status: 'playing' });

    state = playbackReducer(state, { positionSeconds: 3.2, type: 'pause' });
    expect(state).toEqual({ positionSeconds: 3.2, status: 'paused' });

    state = playbackReducer(state, { durationSeconds: DURATION, type: 'toggle' });
    expect(state.status).toBe('playing');

    state = playbackReducer(state, { durationSeconds: DURATION, type: 'toggle' });
    expect(state).toEqual({ positionSeconds: 3.2, status: 'paused' });
  });

  it('restarts from zero when play is pressed at the end', () => {
    const ended = { positionSeconds: DURATION, status: 'ended' as const };

    expect(playbackReducer(ended, { durationSeconds: DURATION, type: 'play' })).toEqual({
      positionSeconds: 0,
      status: 'playing',
    });
  });

  it('clamps seeks and keeps playing when the target is inside the project', () => {
    const playing = { positionSeconds: 4, status: 'playing' as const };

    expect(
      playbackReducer(playing, { durationSeconds: DURATION, positionSeconds: 7, type: 'seek' }),
    ).toEqual({ positionSeconds: 7, status: 'playing' });

    expect(
      playbackReducer(playing, { durationSeconds: DURATION, positionSeconds: -3, type: 'seek' }),
    ).toEqual({ positionSeconds: 0, status: 'playing' });

    expect(
      playbackReducer(playing, { durationSeconds: DURATION, positionSeconds: 42, type: 'seek' }),
    ).toEqual({ positionSeconds: DURATION, status: 'ended' });
  });

  it('ignores progress while paused and ends exactly at the duration', () => {
    expect(
      playbackReducer(createPlaybackState(), {
        durationSeconds: DURATION,
        positionSeconds: 3,
        type: 'progress',
      }),
    ).toEqual({ positionSeconds: 0, status: 'paused' });

    expect(
      playbackReducer(
        { positionSeconds: 9.9, status: 'playing' },
        { durationSeconds: DURATION, positionSeconds: 9.94, type: 'progress' },
      ),
    ).toEqual({ positionSeconds: 9.94, status: 'playing' });

    expect(
      playbackReducer(
        { positionSeconds: 9.9, status: 'playing' },
        { durationSeconds: DURATION, positionSeconds: 10.2, type: 'progress' },
      ),
    ).toEqual({ positionSeconds: DURATION, status: 'ended' });
  });

  it('marks the timeline ended when media reports completion', () => {
    expect(
      playbackReducer(
        { positionSeconds: 8, status: 'playing' },
        { durationSeconds: DURATION, type: 'ended' },
      ),
    ).toEqual({ positionSeconds: DURATION, status: 'ended' });
  });

  it('stays paused for zero-length projects', () => {
    expect(playbackReducer(createPlaybackState(), { durationSeconds: 0, type: 'play' })).toEqual({
      positionSeconds: 0,
      status: 'paused',
    });
  });
});

describe('anchor clock', () => {
  it('advances from the anchor without accumulating drift', () => {
    const anchor = createAnchor(2, 1_000);

    expect(advancePosition(anchor, 1_000)).toBe(2);
    expect(advancePosition(anchor, 1_500)).toBe(2.5);
    expect(advancePosition(anchor, 9_000)).toBe(10);
  });

  it('never moves backwards when the clock goes backwards', () => {
    expect(advancePosition(createAnchor(4, 2_000), 1_000)).toBe(4);
  });
});

describe('drift correction', () => {
  it('corrects media that drifts more than 50ms from the master clock', () => {
    expect(DRIFT_THRESHOLD_SECONDS).toBe(0.05);
    expect(needsDriftCorrection(10, 10.05)).toBe(false);
    expect(needsDriftCorrection(10, 10.051)).toBe(true);
    expect(needsDriftCorrection(10, 9.95)).toBe(false);
    expect(needsDriftCorrection(10, 9.949)).toBe(true);
  });
});

describe('parseTimecode', () => {
  it('accepts seconds, MM:SS, and HH:MM:SS', () => {
    expect(parseTimecode('12')).toBe(12);
    expect(parseTimecode('01:27')).toBe(87);
    expect(parseTimecode('01:02:03')).toBe(3_723);
    expect(parseTimecode('27.5')).toBe(27.5);
  });

  it('rejects malformed or negative timecodes', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('-1')).toBeNull();
    expect(parseTimecode('01:99')).toBeNull();
    expect(parseTimecode('01:02:03:04')).toBeNull();
  });
});
