import { describe, expect, it } from 'vitest';
import type { MusicClip } from '@miaoma/video-project';
import {
  base64ToBytes,
  computeWaveformPeaks,
  isSilentWaveform,
  loadWaveformPeaks,
  MIN_WAVEFORM_BAR_HEIGHT,
  sampleMusicWaveform,
  sampleVoiceWaveform,
  waveformBars,
  waveformPath,
} from './waveform';

function rampPeaks(): Float32Array {
  // 10ms 素材、10 个桶：第 i 桶的峰值就是 i / 10，方便断言片段映射。
  return Float32Array.from({ length: 10 }, (_value, index) => index / 10);
}

/** Float32 只有约 7 位有效精度，断言前统一保留两位小数。 */
function levels(values: Float32Array): number[] {
  return Array.from(values, (value) => Number(value.toFixed(2)));
}

function musicClip(overrides: Partial<MusicClip> = {}): MusicClip {
  return {
    assetId: 'music-1',
    endMs: 8_000,
    id: 'clip-music-1',
    kind: 'music',
    loop: false,
    sourceEndMs: 6_000,
    sourceStartMs: 2_000,
    startMs: 0,
    ...overrides,
  };
}

describe('computeWaveformPeaks', () => {
  it('keeps the loudest sample per bucket instead of averaging', () => {
    const peaks = computeWaveformPeaks([Float32Array.from([0, 0.5, -1, 0.25])], 2);

    expect(levels(peaks)).toEqual([0.5, 1]);
  });

  it('mixes channels by the largest absolute amplitude', () => {
    const left = Float32Array.from([0.2, 0]);
    const right = Float32Array.from([-0.9, 0.4]);
    const peaks = computeWaveformPeaks([left, right], 2);

    expect(levels(peaks)).toEqual([0.9, 0.4]);
  });

  it('returns a flat zero waveform for a silent WAV', () => {
    const peaks = computeWaveformPeaks([new Float32Array(64)], 8);

    expect(levels(peaks)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isSilentWaveform(peaks)).toBe(true);
  });

  it('handles empty channels and invalid bucket counts without throwing', () => {
    expect(Array.from(computeWaveformPeaks([], 4))).toEqual([0, 0, 0, 0]);
    expect(computeWaveformPeaks([new Float32Array(10)], 0)).toHaveLength(0);
  });
});

describe('waveformBars', () => {
  it('draws silent material as a centred flat line', () => {
    const bars = waveformBars([0, 0, 0], 100);

    expect(bars).toHaveLength(3);
    expect(bars[0]).toEqual({
      height: MIN_WAVEFORM_BAR_HEIGHT,
      y: (100 - MIN_WAVEFORM_BAR_HEIGHT) / 2,
    });
  });

  it('scales peaks to the chart height and clamps out-of-range values', () => {
    const bars = waveformBars([1, 0.5, 2, Number.NaN], 100);

    expect(bars.map((bar) => bar.height)).toEqual([100, 50, 100, MIN_WAVEFORM_BAR_HEIGHT]);
    expect(bars[0]?.y).toBe(0);
  });

  it('serialises bars into an SVG path', () => {
    const path = waveformPath(waveformBars([0, 1], 100));

    expect(path).toBe('M0 49h1v2h-1z M1 0h1v100h-1z');
  });
});

describe('sampleMusicWaveform', () => {
  it('follows the trimmed source window without wrapping when loop is off', () => {
    const peaks = rampPeaks();
    const values = sampleMusicWaveform(peaks, 10_000, musicClip(), 8);

    // 柱中心 0.5s、1.5s…，source 从 2s 起；超过 6s 后非循环片段停在 source 末尾。
    expect(levels(values)).toEqual([0.2, 0.3, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6]);
  });

  it('wraps inside the trimmed source window when loop is on', () => {
    const peaks = rampPeaks();
    const values = sampleMusicWaveform(peaks, 10_000, musicClip({ loop: true }), 8);

    // source 窗口 2s-6s 共 4s：第 5 根柱（6.5s）回到 2.5s，波形重复。
    expect(levels(values)).toEqual([0.2, 0.3, 0.4, 0.5, 0.2, 0.3, 0.4, 0.5]);
  });
});

describe('sampleVoiceWaveform', () => {
  it('maps voice clip time back to the start of its asset', () => {
    const values = sampleVoiceWaveform(rampPeaks(), 10_000, { endMs: 4_000, startMs: 0 }, 4);

    expect(levels(values)).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe('loadWaveformPeaks', () => {
  const readOk = async () => 'AQID';

  it('decodes base64 bytes into peak buckets', async () => {
    const decode = async () => [Float32Array.from([1, 0, 0.5, 0])];
    const peaks = await loadWaveformPeaks('voice-1', readOk, decode, 2);

    expect(Array.from(peaks ?? [])).toEqual([1, 0.5]);
  });

  it('returns null when the reader fails or the asset is missing', async () => {
    const decode = async () => [Float32Array.from([1])];

    expect(await loadWaveformPeaks('voice-1', async () => null, decode, 2)).toBeNull();
    expect(
      await loadWaveformPeaks(
        'voice-1',
        async () => {
          throw new Error('IPC_UNAVAILABLE');
        },
        decode,
        2,
      ),
    ).toBeNull();
  });

  it('returns null when decoding fails or yields no channels', async () => {
    expect(
      await loadWaveformPeaks(
        'voice-1',
        readOk,
        async () => {
          throw new Error('DECODE_FAILED');
        },
        2,
      ),
    ).toBeNull();
    expect(await loadWaveformPeaks('voice-1', readOk, async () => [], 2)).toBeNull();
  });
});

describe('base64ToBytes', () => {
  it('decodes a base64 payload into the original bytes', () => {
    expect(Array.from(base64ToBytes('AQID') ?? [])).toEqual([1, 2, 3]);
  });

  it('returns null for invalid base64 instead of throwing', () => {
    expect(base64ToBytes('!!!')).toBeNull();
  });
});
