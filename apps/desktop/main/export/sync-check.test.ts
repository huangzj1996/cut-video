import { describe, expect, it } from 'vitest';
import {
  buildFfprobeArgs,
  evaluateExportSync,
  parseFfprobeJson,
  syncToleranceMs,
  type ExportSyncExpectation,
  type ExportSyncProbe,
} from './sync-check';
import {
  GOLDEN_SYNC_OFFSET_FFPROBE_JSON,
  GOLDEN_SYNC_OK_FFPROBE_JSON,
  withFfprobeJson,
} from './test-support/ffprobe-golden';

/** 与计划编译器对 2 秒时间线给出的期望输出一致（不在测试里重算，直接写死规格）。 */
const EXPECTED: ExportSyncExpectation = {
  audioCodec: 'aac',
  durationMs: 2_000,
  fps: 30,
  height: 1080,
  videoCodec: 'h264',
  width: 1920,
};

const ONE_FRAME_MS = syncToleranceMs(30);

function parse(json: string): ExportSyncProbe {
  const probe = parseFfprobeJson(json);

  if (!probe) {
    throw new Error('golden ffprobe json should parse');
  }

  return probe;
}

function issueCodes(probe: ExportSyncProbe | null): string[] {
  return evaluateExportSync(probe, EXPECTED).issues.map((issue) => issue.code);
}

describe('parseFfprobeJson', () => {
  it('reads the two streams, their start times and durations out of real ffprobe output', () => {
    const probe = parse(GOLDEN_SYNC_OK_FFPROBE_JSON);

    expect(probe.video).toMatchObject({
      codec: 'h264',
      durationMs: 2_000,
      fps: 30,
      height: 1080,
      startMs: 0,
      width: 1920,
    });
    expect(probe.audio).toMatchObject({
      codec: 'aac',
      durationMs: 2_000,
      startMs: 0,
    });
    expect(probe.durationMs).toBe(2_000);
  });

  it('keeps the real 100ms-offset sample: audio starts at 78ms and is 58.667ms short', () => {
    const probe = parse(GOLDEN_SYNC_OFFSET_FFPROBE_JSON);

    expect(probe.video?.startMs).toBe(0);
    expect(probe.audio?.startMs).toBe(78);
    expect(probe.audio?.durationMs).toBeCloseTo(1_941.333, 3);
  });

  it('returns null for output that is not ffprobe JSON', () => {
    expect(parseFfprobeJson('')).toBeNull();
    expect(parseFfprobeJson('not json')).toBeNull();
    expect(parseFfprobeJson('{"format":{"duration":"2.0"}}')).toBeNull();
  });
});

describe('evaluateExportSync', () => {
  it('passes a normal export and reports the objective numbers', () => {
    const report = evaluateExportSync(parse(GOLDEN_SYNC_OK_FFPROBE_JSON), EXPECTED);

    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.toleranceMs).toBeCloseTo(ONE_FRAME_MS, 6);
    expect(report.summary).toEqual({ durationDeltaMs: 0, startDeltaMs: 0 });
    expect(report.measurements).toEqual({
      audioDurationMs: 2_000,
      audioStartMs: 0,
      durationDeltaMs: 0,
      startDeltaMs: 0,
      videoDurationMs: 2_000,
      videoStartMs: 0,
    });
  });

  it('fails the real fixture with an injected 100ms audio offset', () => {
    const report = evaluateExportSync(parse(GOLDEN_SYNC_OFFSET_FFPROBE_JSON), EXPECTED);
    const codes = report.issues.map((issue) => issue.code);

    expect(report.passed).toBe(false);
    expect(codes).toContain('AUDIO_START_OFFSET');
    expect(codes).toContain('AUDIO_DURATION_MISMATCH');
    expect(report.measurements.startDeltaMs).toBe(78);
    expect(report.measurements.durationDeltaMs).toBeCloseTo(58.667, 3);
  });

  it('treats exactly one output frame as within tolerance and anything beyond it as failure', () => {
    const atTolerance = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'audio').duration = '2.033333';
    });
    const beyondTolerance = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'audio').duration = '2.033400';
    });

    expect(evaluateExportSync(parse(atTolerance), EXPECTED).passed).toBe(true);
    expect(evaluateExportSync(parse(beyondTolerance), EXPECTED).passed).toBe(false);
  });

  it('allows encoder padding inside one frame but fails a start offset beyond it', () => {
    const padded = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'audio').start_time = '0.033333';
    });
    const drifted = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'audio').start_time = '0.033400';
      ffprobeStreamFrom(output, 'audio').duration = '1.966600';
    });

    expect(evaluateExportSync(parse(padded), EXPECTED).passed).toBe(true);
    expect(issueCodes(parse(drifted))).toContain('AUDIO_START_OFFSET');
  });

  it('fails when the output parameters differ from the render config', () => {
    const wrongResolution = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      const video = ffprobeStreamFrom(output, 'video');
      video.width = 1280;
      video.height = 720;
    });
    const wrongFrameRate = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'video').avg_frame_rate = '25/1';
      ffprobeStreamFrom(output, 'video').r_frame_rate = '25/1';
    });
    const wrongVideoCodec = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'video').codec_name = 'hevc';
    });
    const wrongAudioCodec = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'audio').codec_name = 'mp3';
    });

    expect(issueCodes(parse(wrongResolution))).toContain('RESOLUTION_MISMATCH');
    expect(issueCodes(parse(wrongFrameRate))).toContain('FRAME_RATE_MISMATCH');
    expect(issueCodes(parse(wrongVideoCodec))).toContain('VIDEO_CODEC_MISMATCH');
    expect(issueCodes(parse(wrongAudioCodec))).toContain('AUDIO_CODEC_MISMATCH');
  });

  it('fails when a stream is missing instead of silently passing', () => {
    const noAudio = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      output.streams = output.streams.filter((stream) => stream.codec_type !== 'audio');
    });
    const noVideo = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      output.streams = output.streams.filter((stream) => stream.codec_type !== 'video');
    });

    expect(issueCodes(parse(noAudio))).toContain('MISSING_AUDIO_STREAM');
    expect(issueCodes(parse(noVideo))).toContain('MISSING_VIDEO_STREAM');
  });

  it('fails when the media metadata cannot be read at all', () => {
    const report = evaluateExportSync(null, EXPECTED);

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(['METADATA_UNPARSABLE']);
    expect(report.measurements.startDeltaMs).toBeNull();
    expect(report.measurements.durationDeltaMs).toBeNull();
  });

  it('fails closed when the start time, resolution or frame rate cannot be read', () => {
    const withoutStartTime = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      delete ffprobeStreamFrom(output, 'audio').start_time;
    });
    const withoutResolution = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      const video = ffprobeStreamFrom(output, 'video');
      delete video.width;
      delete video.height;
    });

    expect(issueCodes(parse(withoutStartTime))).toContain('MISSING_START_TIME');
    expect(issueCodes(parse(withoutResolution))).toContain('MISSING_RESOLUTION');
  });

  it('reports unreadable durations and frame rate instead of guessing', () => {
    const withoutDurations = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      delete output.format.duration;
      delete ffprobeStreamFrom(output, 'video').duration;
      delete ffprobeStreamFrom(output, 'audio').duration;
    });
    const withoutFrameRate = withFfprobeJson(GOLDEN_SYNC_OK_FFPROBE_JSON, (output) => {
      ffprobeStreamFrom(output, 'video').avg_frame_rate = '0/0';
      delete ffprobeStreamFrom(output, 'video').r_frame_rate;
    });

    expect(issueCodes(parse(withoutDurations))).toContain('MISSING_DURATION');
    expect(issueCodes(parse(withoutFrameRate))).toContain('MISSING_FRAME_RATE');
  });
});

describe('buildFfprobeArgs', () => {
  it('asks ffprobe for stream and format facts as JSON', () => {
    const args = buildFfprobeArgs('C:/out.mp4');

    expect(args).toEqual([
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      'C:/out.mp4',
    ]);
  });
});

/** 直接改 withFfprobeJson 回调里已经解析好的流对象。 */
function ffprobeStreamFrom(
  output: { streams: Record<string, unknown>[] },
  type: 'audio' | 'video',
): Record<string, unknown> {
  const stream = output.streams.find((candidate) => candidate.codec_type === type);

  if (!stream) {
    throw new Error('missing ' + type + ' stream');
  }

  return stream;
}
