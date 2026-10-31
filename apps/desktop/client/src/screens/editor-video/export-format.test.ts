import { describe, expect, it } from 'vitest';
import {
  formatExportDelta,
  formatExportElapsed,
  formatExportEta,
  formatExportPercent,
  formatExportSpeed,
} from './export-format';

describe('formatExportEta', () => {
  it('reports a pending estimate when there is no usable value', () => {
    expect(formatExportEta(null)).toBe('计算中');
    expect(formatExportEta(Number.NaN)).toBe('计算中');
    expect(formatExportEta(Number.POSITIVE_INFINITY)).toBe('计算中');
    expect(formatExportEta(Number.NEGATIVE_INFINITY)).toBe('计算中');
    expect(formatExportEta(-1)).toBe('计算中');
  });

  it('counts down to the last seconds as imminent', () => {
    expect(formatExportEta(0)).toBe('即将完成');
    expect(formatExportEta(2999)).toBe('即将完成');
  });

  it('rounds up and uses mm:ss below one hour', () => {
    expect(formatExportEta(3000)).toBe('00:03');
    expect(formatExportEta(3001)).toBe('00:04');
    expect(formatExportEta(65_000)).toBe('01:05');
    expect(formatExportEta(3_599_000)).toBe('59:59');
  });

  it('switches to h:mm:ss once rounding reaches one hour', () => {
    expect(formatExportEta(3_599_500)).toBe('1:00:00');
    expect(formatExportEta(3_600_000)).toBe('1:00:00');
    expect(formatExportEta(3_661_000)).toBe('1:01:01');
    expect(formatExportEta(36_000_000)).toBe('10:00:00');
  });
});

describe('formatExportElapsed', () => {
  it('falls back to zero for invalid or negative values', () => {
    expect(formatExportElapsed(-1)).toBe('00:00');
    expect(formatExportElapsed(Number.NaN)).toBe('00:00');
    expect(formatExportElapsed(Number.POSITIVE_INFINITY)).toBe('00:00');
  });

  it('floors partial seconds', () => {
    expect(formatExportElapsed(0)).toBe('00:00');
    expect(formatExportElapsed(999)).toBe('00:00');
    expect(formatExportElapsed(1000)).toBe('00:01');
    expect(formatExportElapsed(65_400)).toBe('01:05');
    expect(formatExportElapsed(3_599_999)).toBe('59:59');
  });

  it('uses h:mm:ss from one hour on', () => {
    expect(formatExportElapsed(3_600_000)).toBe('1:00:00');
    expect(formatExportElapsed(3_661_999)).toBe('1:01:01');
  });
});

describe('formatExportSpeed', () => {
  it('reports a pending value when speed is unavailable', () => {
    expect(formatExportSpeed(null)).toBe('计算中');
    expect(formatExportSpeed(0)).toBe('计算中');
    expect(formatExportSpeed(-2)).toBe('计算中');
    expect(formatExportSpeed(Number.NaN)).toBe('计算中');
    expect(formatExportSpeed(Number.POSITIVE_INFINITY)).toBe('计算中');
  });

  it('keeps one decimal and appends the multiplier', () => {
    expect(formatExportSpeed(1.234)).toBe('1.2x');
    expect(formatExportSpeed(12.34)).toBe('12.3x');
    expect(formatExportSpeed(2)).toBe('2.0x');
  });
});

describe('formatExportDelta', () => {
  it('renders a placeholder without a measured value', () => {
    expect(formatExportDelta(null)).toBe('—');
    expect(formatExportDelta(Number.NaN)).toBe('—');
    expect(formatExportDelta(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatExportDelta(-1)).toBe('—');
  });

  it('keeps one decimal in milliseconds', () => {
    expect(formatExportDelta(0)).toBe('0.0ms');
    expect(formatExportDelta(78)).toBe('78.0ms');
    expect(formatExportDelta(1000 / 30)).toBe('33.3ms');
    expect(formatExportDelta(58.667)).toBe('58.7ms');
  });
});

describe('formatExportPercent', () => {
  it('renders a placeholder without a value', () => {
    expect(formatExportPercent(null)).toBe('—');
    expect(formatExportPercent(Number.NaN)).toBe('—');
  });

  it('rounds to whole percents', () => {
    expect(formatExportPercent(0)).toBe('0%');
    expect(formatExportPercent(42.4)).toBe('42%');
    expect(formatExportPercent(42.5)).toBe('43%');
    expect(formatExportPercent(99.6)).toBe('100%');
  });

  it('clamps out-of-range values into 0..100', () => {
    expect(formatExportPercent(-5)).toBe('0%');
    expect(formatExportPercent(150)).toBe('100%');
  });
});
