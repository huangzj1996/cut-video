import { describe, expect, it } from 'vitest';
import type { StoredProject } from '@miaoma/video-project';
import {
  mimeTypeForPath,
  parseAssetUrl,
  parseRangeHeader,
  planAssetResponse,
  resolveAssetTarget,
  type AssetFileStat,
} from './asset-protocol';

const PROJECT: StoredProject = {
  assets: {
    music: [{ durationMs: 60_000, id: 'music-1', path: '/media/song.mp3', title: 'Eutopia' }],
    subtitles: [{ id: 'subtitle-1', text: '第一句' }],
    thumbnails: [
      {
        height: 432,
        id: 'thumb-1',
        path: '/media/cache/frame.jpg',
        timeMs: 0,
        width: 768,
      },
    ],
    videos: [
      {
        durationMs: 10_000,
        fps: 30,
        height: 1080,
        id: 'video-1',
        mediaType: 'video',
        path: '/media/我的 视频.mp4',
        thumbnailIds: ['thumb-1'],
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
  canvas: { aspectRatio: '16:9', fps: 30, height: 1080, width: 1920 },
  project: {
    contentRevision: 1,
    createdAt: '2026-10-26T09:00:00.000Z',
    name: '工程',
    projectId: 'project-1',
    updatedAt: '2026-10-27T09:00:00.000Z',
  },
  render: {
    audioBitrateKbps: 192,
    audioCodec: 'aac',
    burnSubtitles: true,
    container: 'mp4',
    sourceAudioMuted: true,
    videoCodec: 'h264',
  },
  scenes: [],
  schemaVersion: '1.0.0',
  tracks: [],
};

const FILES = new Map<string, AssetFileStat>([
  ['/media/我的 视频.mp4', { isFile: true, size: 1_000 }],
  ['/media/voice-1.wav', { isFile: true, size: 400 }],
  ['/media/song.mp3', { isFile: true, size: 60_000 }],
  ['/media/cache/frame.jpg', { isFile: true, size: 2_048 }],
]);

function stat(filePath: string): AssetFileStat | null {
  return FILES.get(filePath) ?? null;
}

function plan(rawUrl: string, options: { method?: string; rangeHeader?: string | null } = {}) {
  return planAssetResponse({
    method: options.method ?? 'GET',
    project: PROJECT,
    rangeHeader: options.rangeHeader ?? null,
    rawUrl,
    stat,
  });
}

describe('parseAssetUrl', () => {
  it('parses the project id from the host and the asset id from the path', () => {
    expect(parseAssetUrl('asset://project-1/video-1')).toEqual({
      assetId: 'video-1',
      projectId: 'project-1',
    });
    expect(parseAssetUrl('asset://project-1/thumb-1?cache=1')).toEqual({
      assetId: 'thumb-1',
      projectId: 'project-1',
    });
  });

  it('rejects other schemes, hosts and ids', () => {
    expect(parseAssetUrl('file:///media/song.mp3')).toBeNull();
    expect(parseAssetUrl('https://project-1/video-1')).toBeNull();
    expect(parseAssetUrl('asset://project-1/')).toBeNull();
    expect(parseAssetUrl('asset://project-1/video-1/extra')).toBeNull();
    expect(parseAssetUrl('asset://../secret/video-1')).toBeNull();
    expect(parseAssetUrl('asset://project-1/..%2Fsecret')).toBeNull();
    expect(parseAssetUrl('asset://project-1/%2e%2e%2fsecret')).toBeNull();
    expect(parseAssetUrl('not a url')).toBeNull();
  });
});

describe('resolveAssetTarget', () => {
  it('resolves only assets registered on the project', () => {
    for (const assetId of ['video-1', 'voice-1', 'music-1', 'thumb-1']) {
      expect(resolveAssetTarget(PROJECT, assetId)).toEqual({
        filePath: expect.any(String),
        ok: true,
      });
    }
  });

  it('rejects unknown, subtitle and traversal ids', () => {
    expect(resolveAssetTarget(PROJECT, 'subtitle-1')).toEqual({ ok: false, status: 404 });
    expect(resolveAssetTarget(PROJECT, 'missing')).toEqual({ ok: false, status: 404 });
    expect(resolveAssetTarget(PROJECT, '../media/song.mp3')).toEqual({ ok: false, status: 403 });
    expect(resolveAssetTarget(PROJECT, '..')).toEqual({ ok: false, status: 403 });
    expect(resolveAssetTarget(PROJECT, 'video 1')).toEqual({ ok: false, status: 403 });
  });

  it('rejects registered assets without an absolute path', () => {
    const relative: StoredProject = {
      ...PROJECT,
      assets: {
        ...PROJECT.assets,
        music: [{ durationMs: 1_000, id: 'music-2', path: 'song.mp3' }],
      },
    };

    expect(resolveAssetTarget(relative, 'music-2')).toEqual({ ok: false, status: 404 });
  });
});

describe('mimeTypeForPath', () => {
  it('maps supported media extensions', () => {
    expect(mimeTypeForPath('/a/b.mp4')).toBe('video/mp4');
    expect(mimeTypeForPath('/a/b.MOV')).toBe('video/quicktime');
    expect(mimeTypeForPath('/a/b.wav')).toBe('audio/wav');
    expect(mimeTypeForPath('/a/b.mp3')).toBe('audio/mpeg');
    expect(mimeTypeForPath('/a/b.m4a')).toBe('audio/mp4');
    expect(mimeTypeForPath('/a/b.jpg')).toBe('image/jpeg');
    expect(mimeTypeForPath('/a/b.png')).toBe('image/png');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(mimeTypeForPath('/a/b.bin')).toBe('application/octet-stream');
  });
});

describe('parseRangeHeader', () => {
  it('treats a missing range as a full response', () => {
    expect(parseRangeHeader(null, 1_000)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('', 1_000)).toEqual({ kind: 'full' });
  });

  it('parses explicit, open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-99', 1_000)).toEqual({ end: 99, kind: 'partial', start: 0 });
    expect(parseRangeHeader('bytes=100-', 1_000)).toEqual({
      end: 999,
      kind: 'partial',
      start: 100,
    });
    expect(parseRangeHeader('bytes=-100', 1_000)).toEqual({
      end: 999,
      kind: 'partial',
      start: 900,
    });
  });

  it('clamps ranges that run past the file end', () => {
    expect(parseRangeHeader('bytes=900-5000', 1_000)).toEqual({
      end: 999,
      kind: 'partial',
      start: 900,
    });
  });

  it('marks malformed, multi-part and out-of-bounds ranges unsatisfiable', () => {
    expect(parseRangeHeader('bytes=1000-', 1_000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=500-400', 1_000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=0-10,20-30', 1_000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('items=0-10', 1_000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-', 1_000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('planAssetResponse', () => {
  it('serves a registered video with MIME headers and byte ranges', () => {
    const response = plan('asset://project-1/video-1');

    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'Accept-Ranges': 'bytes',
      'Content-Length': '1000',
      'Content-Type': 'video/mp4',
    });
    expect(response.body).toEqual({
      end: 999,
      filePath: '/media/我的 视频.mp4',
      start: 0,
    });
  });

  it('serves 206 partial content for range requests', () => {
    const response = plan('asset://project-1/video-1', { rangeHeader: 'bytes=100-199' });

    expect(response.status).toBe(206);
    expect(response.headers).toMatchObject({
      'Content-Length': '100',
      'Content-Range': 'bytes 100-199/1000',
      'Content-Type': 'video/mp4',
    });
    expect(response.body).toEqual({
      end: 199,
      filePath: '/media/我的 视频.mp4',
      start: 100,
    });
  });

  it('answers HEAD with the same headers and no body', () => {
    const response = plan('asset://project-1/music-1', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.body).toBeUndefined();
    expect(response.headers).toMatchObject({
      'Content-Length': '60000',
      'Content-Type': 'audio/mpeg',
    });
  });

  it('answers unsatisfiable ranges with 416 and the file size', () => {
    const response = plan('asset://project-1/video-1', { rangeHeader: 'bytes=5000-' });

    expect(response.status).toBe(416);
    expect(response.body).toBeUndefined();
    expect(response.headers).toMatchObject({
      'Content-Length': '0',
      'Content-Range': 'bytes */1000',
    });
  });

  it('returns 404 for unknown asset ids, missing files and other projects', () => {
    expect(plan('asset://project-1/unknown').status).toBe(404);
    expect(plan('asset://other-project/video-1').status).toBe(404);

    const missing = planAssetResponse({
      method: 'GET',
      project: PROJECT,
      rangeHeader: null,
      rawUrl: 'asset://project-1/video-1',
      stat: () => null,
    });

    expect(missing.status).toBe(404);
  });

  it('returns 403 for malformed and traversal URLs', () => {
    expect(plan('asset://project-1/..%2Fsecret').status).toBe(403);
    expect(plan('asset://project-1/video 1').status).toBe(403);
    expect(plan('file:///media/song.mp3').status).toBe(403);
  });

  it('returns 404 when no project is available', () => {
    const response = planAssetResponse({
      method: 'GET',
      project: null,
      rangeHeader: null,
      rawUrl: 'asset://project-1/video-1',
      stat,
    });

    expect(response.status).toBe(404);
  });

  it('rejects methods other than GET and HEAD', () => {
    const response = plan('asset://project-1/video-1', { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers).toMatchObject({ Allow: 'GET, HEAD' });
  });
});
