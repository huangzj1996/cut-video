import { describe, expect, it } from 'vitest';
import { parseFfprobeDurationSeconds } from './audio-probe';

describe('parseFfprobeDurationSeconds', () => {
  it('reads the duration from ffprobe JSON output', () => {
    expect(parseFfprobeDurationSeconds('{"format":{"duration":"121.456"}}')).toBe(121.456);
    expect(parseFfprobeDurationSeconds('{"format":{"duration":9.5}}')).toBe(9.5);
  });

  it('reads a bare numeric duration', () => {
    expect(parseFfprobeDurationSeconds('12.5\n')).toBe(12.5);
  });

  it('rejects missing, zero, negative and malformed durations', () => {
    expect(parseFfprobeDurationSeconds('')).toBeNull();
    expect(parseFfprobeDurationSeconds('{"format":{}}')).toBeNull();
    expect(parseFfprobeDurationSeconds('{"format":{"duration":"0"}}')).toBeNull();
    expect(parseFfprobeDurationSeconds('{"format":{"duration":"-1"}}')).toBeNull();
    expect(parseFfprobeDurationSeconds('not json')).toBeNull();
    expect(parseFfprobeDurationSeconds('{"format":"oops"}')).toBeNull();
  });
});
