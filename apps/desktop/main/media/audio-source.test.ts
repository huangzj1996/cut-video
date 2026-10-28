import { describe, expect, it } from 'vitest';
import type { AudioSourceProject } from './audio-source';
import { MAX_AUDIO_SOURCE_BYTES, planAudioSourceRead } from './audio-source';

const PROJECT: AudioSourceProject = {
  assets: {
    music: [
      { durationMs: 12_000, id: 'music-1', path: '/media/song.mp3' },
      { durationMs: 12_000, id: 'music-relative', path: 'relative/song.mp3' },
    ],
    subtitles: [{ id: 'sub-1', text: '字幕' }],
    thumbnails: [{ height: 432, id: 'thumb-1', path: '/media/thumb.jpg', timeMs: 0, width: 768 }],
    videos: [
      {
        durationMs: 10_000,
        fps: 30,
        height: 1080,
        id: 'video-1',
        mediaType: 'video',
        path: '/media/source.mp4',
        thumbnailIds: [],
        width: 1920,
      },
    ],
    voices: [
      {
        durationMs: 4_000,
        id: 'voice-1',
        isMock: true,
        path: '/media/voice-1.wav',
        provider: 'mock',
        voice: 'wenrou-xuejie',
      },
    ],
  },
};

function statOf(size: number) {
  return () => ({ isFile: true, size });
}

describe('planAudioSourceRead', () => {
  it('resolves voice and music assets to their absolute path and MIME type', () => {
    expect(
      planAudioSourceRead({ assetId: 'voice-1', project: PROJECT, stat: statOf(1_024) }),
    ).toEqual({ filePath: '/media/voice-1.wav', mimeType: 'audio/wav', ok: true });
    expect(
      planAudioSourceRead({ assetId: 'music-1', project: PROJECT, stat: statOf(1_024) }),
    ).toEqual({ filePath: '/media/song.mp3', mimeType: 'audio/mpeg', ok: true });
  });

  it('rejects unknown, non-audio or relative-path assets', () => {
    expect(
      planAudioSourceRead({ assetId: 'video-1', project: PROJECT, stat: statOf(1_024) }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_NOT_FOUND', ok: false });
    expect(
      planAudioSourceRead({ assetId: 'thumb-1', project: PROJECT, stat: statOf(1_024) }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_NOT_FOUND', ok: false });
    expect(
      planAudioSourceRead({ assetId: 'music-relative', project: PROJECT, stat: statOf(1_024) }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_NOT_FOUND', ok: false });
    expect(
      planAudioSourceRead({ assetId: '../song', project: PROJECT, stat: statOf(1_024) }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_NOT_FOUND', ok: false });
  });

  it('treats a missing or oversized file as unavailable', () => {
    expect(
      planAudioSourceRead({
        assetId: 'voice-1',
        project: PROJECT,
        stat: () => ({ isFile: false, size: 0 }),
      }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_NOT_FOUND', ok: false });
    expect(
      planAudioSourceRead({
        assetId: 'voice-1',
        project: PROJECT,
        stat: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_NOT_FOUND', ok: false });
    expect(
      planAudioSourceRead({
        assetId: 'voice-1',
        project: PROJECT,
        stat: statOf(MAX_AUDIO_SOURCE_BYTES + 1),
      }),
    ).toMatchObject({ code: 'MEDIA_AUDIO_TOO_LARGE', ok: false });
  });
});
