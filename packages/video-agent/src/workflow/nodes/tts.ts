import type { VoiceSubtitleCue } from '@miaoma/video-project';

const CHINESE_CHARS_PER_SECOND = 4.5;
const LATIN_WORDS_PER_SECOND = 2.8;
const MIN_SEGMENT_MS = 500;
const MAX_SEGMENT_MS = 300_000;
const MIN_CUE_MS = 500;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function estimateSpeechDurationMs(text: string, speed: number): number {
  const normalizedSpeed = Math.min(2, Math.max(0.5, speed));
  const chineseCount = countMatches(text, /[一-鿿]/g);
  const latinWords = countMatches(text, /[A-Za-z0-9]+/g);
  const punctuationCount = countMatches(text, /[，。！？；：、,.!?;:]/g);
  const punctuationPauseMs = punctuationCount * 120;
  const speechSeconds =
    chineseCount / CHINESE_CHARS_PER_SECOND + latinWords / LATIN_WORDS_PER_SECOND;
  const durationMs = Math.round((speechSeconds * 1_000) / normalizedSpeed + punctuationPauseMs);

  return Math.min(MAX_SEGMENT_MS, Math.max(MIN_SEGMENT_MS, durationMs));
}

function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？!?；;\n])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length > 0) {
    return parts;
  }

  const trimmed = text.trim();
  return trimmed.length > 0 ? [trimmed] : ['旁白'];
}

function splitLongCue(text: string, maxLength = 24): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    const breakAt = Math.max(
      window.lastIndexOf('，'),
      window.lastIndexOf('、'),
      window.lastIndexOf(','),
      window.lastIndexOf(' '),
    );
    const cut = breakAt > maxLength / 2 ? breakAt + 1 : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * 句级字幕：先按句号/问号切句，过长再按逗号切块；按字符数比例分配时长。
 * 时间单位是相对 segment 起点的毫秒。
 */
export function buildSubtitleCues(
  sceneId: string,
  text: string,
  durationMs: number,
): VoiceSubtitleCue[] {
  let chunks = splitSentences(text).flatMap((sentence) => splitLongCue(sentence));

  // 句子太多、时长太短时先合并，保证每条字幕至少有可见时间。
  while (chunks.length > 1 && chunks.length * MIN_CUE_MS > durationMs) {
    chunks = [`${chunks[0]} ${chunks[1]}`.trim(), ...chunks.slice(2)];
  }

  const weights = chunks.map((chunk) => Math.max(1, chunk.replace(/\s/g, '').length));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const minCueMs = Math.min(MIN_CUE_MS, Math.max(1, Math.floor(durationMs / chunks.length)));
  let cursor = 0;

  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    let cueDuration: number;

    if (isLast) {
      cueDuration = Math.max(1, durationMs - cursor);
    } else {
      const remainingCues = chunks.length - index - 1;
      const maxForCue = Math.max(minCueMs, durationMs - cursor - remainingCues * minCueMs);
      const ideal = Math.round((weights[index]! / totalWeight) * durationMs);
      cueDuration = Math.min(maxForCue, Math.max(minCueMs, ideal));
    }

    const startMs = Math.min(cursor, Math.max(0, durationMs - 1));
    const endMs = Math.min(durationMs, Math.max(startMs + 1, startMs + cueDuration));
    cursor = endMs;

    return {
      id: `cue-${sceneId}-${index + 1}`,
      text: chunk,
      startMs,
      endMs,
    };
  });
}

/**
 * 16kHz / 单声道 / 16-bit PCM 静音 WAV。首版模拟配音不写真实音频内容，
 * 只保证时长、容器和后续时间线/导出参数合法。
 */
export function createSilentWav(durationMs: number): Uint8Array {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.max(1, Math.round((durationMs / 1_000) * sampleRate));
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
