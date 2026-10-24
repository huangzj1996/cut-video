import { describe, expect, it } from 'vitest';
import {
  clampTime,
  clientXToTime,
  findActiveClip,
  formatTime,
  resolvePreviewFrame,
  secondsToPercent,
  type TimelineClip,
} from './timeline';

const CLIPS: readonly TimelineClip[] = [
  {
    accent: '#25d0b1',
    background: '#1f6158',
    endSeconds: 20,
    id: 'clip-1',
    label: '分镜 01',
    startSeconds: 0,
  },
  {
    accent: '#5b8cff',
    background: '#294673',
    endSeconds: 40,
    id: 'clip-2',
    label: '分镜 02',
    startSeconds: 20,
  },
];

describe('clampTime', () => {
  it('keeps in-range values', () => {
    expect(clampTime(12.5, 114.8)).toBe(12.5);
  });

  it('clamps negative values to zero', () => {
    expect(clampTime(-3, 114.8)).toBe(0);
  });

  it('clamps values beyond the end', () => {
    expect(clampTime(200, 114.8)).toBe(114.8);
  });

  it('handles a non-positive maximum', () => {
    expect(clampTime(5, 0)).toBe(0);
    expect(clampTime(5, -10)).toBe(0);
  });
});

describe('clientXToTime', () => {
  it('maps the left and right edges', () => {
    expect(clientXToTime(0, { left: 0, width: 1000 }, 114.8)).toBe(0);
    expect(clientXToTime(1000, { left: 0, width: 1000 }, 114.8)).toBe(114.8);
  });

  it('clamps coordinates outside the track', () => {
    expect(clientXToTime(-200, { left: 0, width: 1000 }, 114.8)).toBe(0);
    expect(clientXToTime(1400, { left: 0, width: 1000 }, 114.8)).toBe(114.8);
  });

  it('accounts for horizontal scrolling and zoomed widths', () => {
    expect(clientXToTime(300, { left: -200, width: 1000 }, 100)).toBe(50);
    expect(clientXToTime(500, { left: 0, width: 2000 }, 100)).toBe(25);
  });

  it('returns zero for a collapsed track', () => {
    expect(clientXToTime(500, { left: 0, width: 0 }, 114.8)).toBe(0);
  });
});

describe('secondsToPercent', () => {
  it('converts project time to ruler percent', () => {
    expect(secondsToPercent(87, 114.8)).toBeCloseTo(75.78, 1);
  });

  it('clamps to 0-100', () => {
    expect(secondsToPercent(-4, 114.8)).toBe(0);
    expect(secondsToPercent(180, 114.8)).toBe(100);
  });

  it('handles a non-positive span', () => {
    expect(secondsToPercent(10, 0)).toBe(0);
  });
});

describe('findActiveClip', () => {
  it('returns the clip at the start, boundaries, and last frame', () => {
    expect(findActiveClip(CLIPS, 0)?.id).toBe('clip-1');
    expect(findActiveClip(CLIPS, 19.99)?.id).toBe('clip-1');
    expect(findActiveClip(CLIPS, 20)?.id).toBe('clip-2');
    expect(findActiveClip(CLIPS, 40)?.id).toBe('clip-2');
  });

  it('returns undefined outside the content range', () => {
    expect(findActiveClip(CLIPS, -1)).toBeUndefined();
    expect(findActiveClip(CLIPS, 40.01)).toBeUndefined();
    expect(findActiveClip(CLIPS, 90)).toBeUndefined();
  });
});

describe('resolvePreviewFrame', () => {
  it('returns the active clip and local frame', () => {
    const frame = resolvePreviewFrame(25, CLIPS, 40);

    expect(frame.kind).toBe('clip');

    if (frame.kind === 'clip') {
      expect(frame.clip.id).toBe('clip-2');
      expect(frame.localSeconds).toBe(5);
      expect(frame.frameIndex).toBe(150);
    }
  });

  it('keeps the last frame at the exact project end', () => {
    const frame = resolvePreviewFrame(40, CLIPS, 40);

    expect(frame.kind).toBe('clip');

    if (frame.kind === 'clip') {
      expect(frame.clip.id).toBe('clip-2');
    }
  });

  it('returns an empty frame in the dead zone', () => {
    expect(resolvePreviewFrame(40.01, CLIPS, 40).kind).toBe('empty');
    expect(resolvePreviewFrame(114.8, CLIPS, 87).kind).toBe('empty');
  });
});

describe('formatTime', () => {
  it('formats seconds as HH:MM:SS', () => {
    expect(formatTime(0)).toBe('00:00:00');
    expect(formatTime(87.9)).toBe('00:01:27');
    expect(formatTime(3661)).toBe('01:01:01');
  });

  it('never formats negative values', () => {
    expect(formatTime(-1)).toBe('00:00:00');
  });
});
