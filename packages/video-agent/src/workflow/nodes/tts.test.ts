import { describe, expect, it } from 'vitest';
import { buildSubtitleCues, createSilentWav, estimateSpeechDurationMs } from './tts';

describe('mock TTS helpers', () => {
  it('estimates longer duration for longer text and shorter duration for faster speed', () => {
    const short = estimateSpeechDurationMs('你好。', 1);
    const long = estimateSpeechDurationMs('这是一段更长的测试文本，用来估算配音时长。', 1);
    const fast = estimateSpeechDurationMs('这是一段更长的测试文本，用来估算配音时长。', 1.2);

    expect(short).toBeGreaterThanOrEqual(500);
    expect(long).toBeGreaterThan(short);
    expect(fast).toBeLessThan(long);
  });

  it('writes a silent 16kHz mono 16-bit WAV', () => {
    const wav = createSilentWav(1_000);
    const view = Buffer.from(wav);

    expect(view.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(view.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(view.readUInt32LE(24)).toBe(16_000);
    expect(view.readUInt16LE(22)).toBe(1);
    expect(view.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(44 + 32_000);
  });

  it('keeps subtitle cues ordered and inside the segment duration', () => {
    const cues = buildSubtitleCues('scene-01', '第一句话。第二句话，稍微长一点。第三句！', 5_000);

    expect(cues.length).toBeGreaterThan(0);

    for (const cue of cues) {
      expect(cue.startMs).toBeGreaterThanOrEqual(0);
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
      expect(cue.endMs).toBeLessThanOrEqual(5_000);
    }

    for (let index = 1; index < cues.length; index += 1) {
      expect(cues[index]!.startMs).toBeGreaterThanOrEqual(cues[index - 1]!.endMs);
    }
  });

  it('merges cues when the segment is too short for one cue per sentence', () => {
    const cues = buildSubtitleCues('scene-01', '一。二。三。四。五。', 700);

    expect(cues.length).toBeLessThanOrEqual(2);

    for (const cue of cues) {
      expect(cue.endMs).toBeLessThanOrEqual(700);
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
    }
  });
});
