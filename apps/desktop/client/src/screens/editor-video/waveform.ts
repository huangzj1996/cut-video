import type { MusicClip } from '@miaoma/video-project';
import { resolveMusicSourceSeconds } from './preview-media';
/**
 * 时间线波形：把解码后的音频采样压成峰值桶，再按片段的 source 区间
 * （含 music 的裁剪与 loop）映射成可绘制的柱形。
 *
 * 这里只做纯计算，不碰 DOM；解码与 IPC 读取由调用方注入，便于单测。
 */

/** 整条音频素材的峰值桶数：足够细，之后按片段再降采样。 */
export const WAVEFORM_RESOLUTION = 1_024;
/** 单个时间线片段绘制的柱数。 */
export const WAVEFORM_BARS_PER_CLIP = 64;
/** 静音柱的最小高度，保证平线仍然可见（而不是消失）。 */
export const MIN_WAVEFORM_BAR_HEIGHT = 2;

export interface WaveformBar {
  /** 柱形高度（与传入的 height 同单位）。 */
  height: number;
  /** 柱形顶部的 y 坐标（柱形在竖直方向居中）。 */
  y: number;
}

export type AudioChannelDecoder = (bytes: ArrayBuffer) => Promise<Float32Array[]>;
export type AudioBase64Reader = (assetId: string) => Promise<string | null>;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

/**
 * 多声道混合为每桶峰值（0..1）。取声道绝对值最大者作为该采样点的幅度，
 * 不取平均，避免左右声道反相时把真实音量抵消掉。
 */
export function computeWaveformPeaks(
  channels: readonly Float32Array[],
  bucketCount = WAVEFORM_RESOLUTION,
): Float32Array {
  if (!Number.isFinite(bucketCount) || bucketCount <= 0) {
    return new Float32Array(0);
  }

  const buckets = Math.max(1, Math.floor(bucketCount));
  const peaks = new Float32Array(buckets);
  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);

  if (length === 0) {
    return peaks;
  }

  for (let index = 0; index < length; index += 1) {
    let amplitude = 0;

    for (const channel of channels) {
      const sample = channel[index];

      if (sample !== undefined) {
        amplitude = Math.max(amplitude, Math.abs(sample));
      }
    }

    const bucket = Math.min(buckets - 1, Math.floor((index * buckets) / length));

    peaks[bucket] = Math.max(peaks[bucket] ?? 0, amplitude);
  }

  return peaks;
}

/** 静音素材（例如模拟配音的静音 WAV）的峰值全为 0，界面据此画平线。 */
export function isSilentWaveform(peaks: Float32Array): boolean {
  for (const peak of peaks) {
    if (peak > 0) {
      return false;
    }
  }

  return true;
}

function peakIndexForSourceSeconds(
  sourceSeconds: number,
  assetDurationMs: number,
  peakCount: number,
): number {
  if (!(assetDurationMs > 0) || peakCount <= 0) {
    return 0;
  }

  const ratio = sourceSeconds / (assetDurationMs / 1_000);

  return Math.min(peakCount - 1, Math.max(0, Math.floor(ratio * peakCount)));
}

function samplePeaks(
  peaks: Float32Array,
  assetDurationMs: number,
  sourceSecondsAt: (barIndex: number) => number,
  barCount: number,
): Float32Array {
  const bars = Math.max(1, Math.floor(barCount));
  const values = new Float32Array(bars);

  if (peaks.length === 0) {
    return values;
  }

  for (let index = 0; index < bars; index += 1) {
    const sourceSeconds = sourceSecondsAt(index);

    values[index] =
      peaks[peakIndexForSourceSeconds(sourceSeconds, assetDurationMs, peaks.length)] ?? 0;
  }

  return values;
}

/**
 * 音乐片段的柱形：逐柱用 `resolveMusicSourceSeconds` 求 source 时间，
 * 因此裁剪后的区间和 loop 循环都会如实体现在波形里。
 */
export function sampleMusicWaveform(
  peaks: Float32Array,
  assetDurationMs: number,
  clip: Pick<MusicClip, 'endMs' | 'loop' | 'sourceEndMs' | 'sourceStartMs' | 'startMs'>,
  barCount = WAVEFORM_BARS_PER_CLIP,
): Float32Array {
  const durationMs = Math.max(0, clip.endMs - clip.startMs);

  return samplePeaks(
    peaks,
    assetDurationMs,
    (barIndex) => {
      const timelineMs = clip.startMs + ((barIndex + 0.5) / barCount) * durationMs;

      return resolveMusicSourceSeconds(clip, timelineMs / 1_000);
    },
    barCount,
  );
}

/** 配音片段固定从素材起点播放，只需把片段内时间映射回 source 秒。 */
export function sampleVoiceWaveform(
  peaks: Float32Array,
  assetDurationMs: number,
  clip: { endMs: number; startMs: number },
  barCount = WAVEFORM_BARS_PER_CLIP,
): Float32Array {
  const durationMs = Math.max(0, clip.endMs - clip.startMs);

  return samplePeaks(
    peaks,
    assetDurationMs,
    (barIndex) => (((barIndex + 0.5) / barCount) * durationMs) / 1_000,
    barCount,
  );
}

/**
 * 柱形几何：按 `height` 居中，静音柱保留最小高度形成一条平线。
 */
export function waveformBars(
  values: Float32Array | readonly number[],
  height = 100,
  minBarHeight = MIN_WAVEFORM_BAR_HEIGHT,
): WaveformBar[] {
  const chartHeight = Math.max(0, height);
  const minHeight = Math.min(chartHeight, Math.max(0, minBarHeight));

  return Array.from(values, (value) => {
    const barHeight = Math.max(minHeight, clamp01(Number(value)) * chartHeight);

    return {
      height: barHeight,
      y: (chartHeight - barHeight) / 2,
    };
  });
}

/** 把柱形拼成一条 SVG path（每根柱一个 1 单位宽的矩形）。 */
export function waveformPath(bars: readonly WaveformBar[]): string {
  return bars.map((bar, index) => `M${index} ${bar.y}h1v${bar.height}h-1z`).join(' ');
}

/**
 * base64 文本转字节。IPC 只传 base64 字符串，避免 contextBridge 对类型化数组的
 * 序列化差异；失败时返回 null，由调用方回退到静态占位。
 */
export function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy.buffer;
}

/**
 * 用 OfflineAudioContext 解码音频；Chromium 支持 WAV/MP3/M4A/AAC。
 * 放到 OfflineAudioContext 上解码不会播放声音，也不需要用户交互授权。
 */
export async function decodeAudioChannels(bytes: ArrayBuffer): Promise<Float32Array[]> {
  const OfflineContext = globalThis.OfflineAudioContext;

  if (!OfflineContext) {
    throw new Error('OFFLINE_AUDIO_CONTEXT_UNAVAILABLE');
  }

  const context = new OfflineContext(1, 1, 48_000);
  const buffer = await context.decodeAudioData(bytes);
  const channels: Float32Array[] = [];

  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index));
  }

  return channels;
}

/**
 * 读取并解码一条音频素材的峰值；任何一步失败（IPC、base64、解码）都返回 null，
 * 让界面显示静态占位而不是崩溃。
 */
export async function loadWaveformPeaks(
  assetId: string,
  readBase64: AudioBase64Reader,
  decodeChannels: AudioChannelDecoder,
  bucketCount = WAVEFORM_RESOLUTION,
): Promise<Float32Array | null> {
  try {
    const base64 = await readBase64(assetId);

    if (!base64) {
      return null;
    }

    const bytes = base64ToBytes(base64);

    if (!bytes) {
      return null;
    }

    const channels = await decodeChannels(toArrayBuffer(bytes));

    if (channels.length === 0) {
      return null;
    }

    return computeWaveformPeaks(channels, bucketCount);
  } catch {
    return null;
  }
}
