import { describe, expect, it } from 'vitest';
import { clampTime, clientXToTime, formatTime, secondsToPercent } from './timeline';

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
