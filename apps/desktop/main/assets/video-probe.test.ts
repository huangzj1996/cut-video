import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFfprobeOutput, probeVideo } from './video-probe';

function ffprobeJson(
  streams: Array<Record<string, unknown>>,
  format: Record<string, unknown> = {},
): string {
  return JSON.stringify({ format, streams });
}

describe('parseFfprobeOutput', () => {
  it('parses duration, resolution, frame rate, codec, and container fields', () => {
    const output = ffprobeJson(
      [
        {
          avg_frame_rate: '30000/1001',
          codec_long_name: 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
          codec_name: 'h264',
          codec_type: 'video',
          color_primaries: 'bt709',
          color_space: 'bt709',
          color_transfer: 'bt709',
          display_aspect_ratio: '16:9',
          disposition: { attached_pic: 0 },
          height: 1080,
          nb_frames: '375',
          pix_fmt: 'yuv420p',
          profile: 'High',
          r_frame_rate: '30000/1001',
          sample_aspect_ratio: '1:1',
          width: 1920,
        },
      ],
      {
        bit_rate: '2000000',
        duration: '12.5',
        format_long_name: 'QuickTime / MOV',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        size: '3125000',
      },
    );

    expect(parseFfprobeOutput(output)).toMatchObject({
      bitRate: 2_000_000,
      codec: 'h264',
      codecLongName: 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
      codedHeight: 1080,
      codedWidth: 1920,
      colorPrimaries: 'bt709',
      colorSpace: 'bt709',
      colorTransfer: 'bt709',
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      displayAspectRatio: '16:9',
      durationMs: 12_500,
      formatLongName: 'QuickTime / MOV',
      fps: 30_000 / 1001,
      frameCount: 375,
      height: 1080,
      isHdr: false,
      isVfr: false,
      pixelFormat: 'yuv420p',
      profile: 'High',
      rotation: 0,
      sampleAspectRatio: '1:1',
      sizeBytes: 3_125_000,
      width: 1920,
    });
  });

  it('normalizes rotation and swaps display dimensions for 90/270 degrees', () => {
    const output = ffprobeJson(
      [
        {
          avg_frame_rate: '30/1',
          codec_type: 'video',
          disposition: { attached_pic: 0 },
          height: 1080,
          r_frame_rate: '30/1',
          side_data_list: [{ rotation: -90 }],
          width: 1920,
        },
      ],
      { duration: '5' },
    );

    expect(parseFfprobeOutput(output)).toMatchObject({
      codedHeight: 1080,
      codedWidth: 1920,
      height: 1920,
      rotation: 270,
      width: 1080,
    });
  });

  it('detects VFR, HDR, and the first audio stream', () => {
    const output = ffprobeJson(
      [
        {
          avg_frame_rate: '24/1',
          codec_name: 'hevc',
          codec_type: 'video',
          color_primaries: 'bt2020',
          color_transfer: 'smpte2084',
          disposition: { attached_pic: 0 },
          height: 2160,
          pix_fmt: 'yuv420p10le',
          profile: 'Main 10',
          r_frame_rate: '30/1',
          width: 3840,
        },
        {
          bit_rate: '128000',
          channel_layout: 'stereo',
          channels: 2,
          codec_name: 'aac',
          codec_type: 'audio',
          sample_rate: '48000',
        },
      ],
      { duration: '10' },
    );

    expect(parseFfprobeOutput(output)).toMatchObject({
      audio: {
        bitRate: 128_000,
        channelLayout: 'stereo',
        channels: 2,
        codec: 'aac',
        sampleRate: 48_000,
      },
      codec: 'hevc',
      isHdr: true,
      isVfr: true,
      pixelFormat: 'yuv420p10le',
      profile: 'Main 10',
    });
  });

  it('falls back to r_frame_rate and stream duration', () => {
    const output = ffprobeJson(
      [
        {
          codec_type: 'video',
          disposition: { attached_pic: 0 },
          duration: '3.5',
          height: 720,
          r_frame_rate: '25/1',
          width: 1280,
        },
      ],
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
      [
        {
          codec_type: 'video',
          disposition: { attached_pic: 1 },
          height: 600,
          width: 600,
        },
      ],
      { duration: '30' },
    );

    expect(parseFfprobeOutput(coverArt)).toBeNull();
    expect(parseFfprobeOutput('not json')).toBeNull();
    expect(parseFfprobeOutput('{}')).toBeNull();
  });

  it('rejects zero duration or frame rate', () => {
    const zeroDuration = ffprobeJson(
      [
        {
          avg_frame_rate: '30/1',
          codec_type: 'video',
          disposition: { attached_pic: 0 },
          height: 1080,
          r_frame_rate: '30/1',
          width: 1920,
        },
      ],
      { duration: '0' },
    );
    const zeroFps = ffprobeJson(
      [
        {
          avg_frame_rate: '0/0',
          codec_type: 'video',
          disposition: { attached_pic: 0 },
          height: 1080,
          width: 1920,
        },
      ],
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
