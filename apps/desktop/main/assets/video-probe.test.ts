import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFfprobeOutput, probeVideo } from './video-probe';

function ffprobeJson(stream: Record<string, unknown>, format: Record<string, unknown>): string {
  return JSON.stringify({ format, streams: [stream] });
}

describe('parseFfprobeOutput', () => {
  it('parses duration, frame rate, and display size', () => {
    const output = ffprobeJson(
      {
        avg_frame_rate: '30000/1001',
        codec_type: 'video',
        disposition: { attached_pic: 0 },
        height: 1080,
        width: 1920,
      },
      { duration: '12.5' },
    );

    expect(parseFfprobeOutput(output)).toEqual({
      durationMs: 12500,
      fps: 30000 / 1001,
      height: 1080,
      width: 1920,
    });
  });

  it('swaps dimensions for 90/270 degree rotation', () => {
    const output = ffprobeJson(
      {
        avg_frame_rate: '30/1',
        codec_type: 'video',
        disposition: { attached_pic: 0 },
        height: 1080,
        side_data_list: [{ rotation: -90 }],
        width: 1920,
      },
      { duration: '5' },
    );

    expect(parseFfprobeOutput(output)).toMatchObject({
      height: 1920,
      width: 1080,
    });
  });

  it('falls back to r_frame_rate and stream duration', () => {
    const output = ffprobeJson(
      {
        codec_type: 'video',
        disposition: { attached_pic: 0 },
        duration: '3.5',
        height: 720,
        r_frame_rate: '25/1',
        width: 1280,
      },
      {},
    );

    expect(parseFfprobeOutput(output)).toMatchObject({
      durationMs: 3500,
      fps: 25,
      height: 720,
      width: 1280,
    });
  });

  it('ignores cover-art video streams and invalid output', () => {
    const coverArt = ffprobeJson(
      {
        codec_type: 'video',
        disposition: { attached_pic: 1 },
        height: 600,
        width: 600,
      },
      { duration: '30' },
    );

    expect(parseFfprobeOutput(coverArt)).toBeNull();
    expect(parseFfprobeOutput('not json')).toBeNull();
    expect(parseFfprobeOutput('{}')).toBeNull();
  });

  it('rejects zero duration or frame rate', () => {
    const zeroDuration = ffprobeJson(
      {
        avg_frame_rate: '30/1',
        codec_type: 'video',
        disposition: { attached_pic: 0 },
        height: 1080,
        width: 1920,
      },
      { duration: '0' },
    );
    const zeroFps = ffprobeJson(
      {
        avg_frame_rate: '0/0',
        codec_type: 'video',
        disposition: { attached_pic: 0 },
        height: 1080,
        width: 1920,
      },
      { duration: '10' },
    );

    expect(parseFfprobeOutput(zeroDuration)).toBeNull();
    expect(parseFfprobeOutput(zeroFps)).toBeNull();
  });
});

describe('probeVideo', () => {
  it('returns null when the ffprobe binary cannot start', async () => {
    const missingBinary = path.join(tmpdir(), 'miaoma-missing-ffprobe.exe');

    await expect(probeVideo(missingBinary, 'clip.mp4')).resolves.toBeNull();
  });
});
