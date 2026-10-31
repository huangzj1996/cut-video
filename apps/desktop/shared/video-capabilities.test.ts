import { describe, expect, it } from 'vitest';
import type { VideoAsset } from '@miaoma/video-project';
import { findVideoCapabilityProblem, PLAYABLE_VIDEO_CODECS } from './video-capabilities';

function asset(overrides: Partial<VideoAsset> = {}): VideoAsset {
  return {
    durationMs: 1_000,
    fps: 30,
    height: 1080,
    id: 'video-a',
    mediaType: 'video',
    path: 'C:/media/a.mp4',
    thumbnailIds: [],
    width: 1920,
    ...overrides,
  };
}

describe('video capability boundary', () => {
  it('accepts H.264 aliases and legacy assets without a codec field', () => {
    for (const codec of ['h264', 'avc', 'avc1', 'AVC']) {
      expect(findVideoCapabilityProblem(asset({ codec }))).toBeNull();
    }

    expect(findVideoCapabilityProblem(asset())).toBeNull();
  });

  it('reports unsupported codecs together with the offending codec', () => {
    expect(findVideoCapabilityProblem(asset({ codec: 'hevc' }))).toEqual({
      codec: 'hevc',
      kind: 'unsupported-codec',
    });
  });

  it('reports HDR and VFR as their own boundary kinds', () => {
    expect(findVideoCapabilityProblem(asset({ isHdr: true }))).toEqual({
      kind: 'unsupported-hdr',
    });
    expect(findVideoCapabilityProblem(asset({ isVfr: true }))).toEqual({
      kind: 'unsupported-vfr',
    });
  });

  it('does not apply video capability limits to images', () => {
    expect(
      findVideoCapabilityProblem(
        asset({ codec: 'hevc', isHdr: true, isVfr: true, mediaType: 'image' }),
      ),
    ).toBeNull();
  });

  it('keeps the supported-codec set aligned with the aliases', () => {
    expect([...PLAYABLE_VIDEO_CODECS].sort()).toEqual(['avc', 'avc1', 'h264']);
  });
});
