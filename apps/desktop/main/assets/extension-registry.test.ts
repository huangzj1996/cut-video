import { describe, expect, it } from 'vitest';
import { getExtensionInfo, getFileExtension, SUPPORTED_EXTENSIONS } from './extension-registry';

describe('extension-registry', () => {
  it('maps supported extensions case-insensitively', () => {
    expect(getFileExtension('Clip.MP4')).toBe('mp4');
    expect(getFileExtension('photo.JPEG')).toBe('jpeg');
    expect(getFileExtension('README')).toBe('');

    expect(getExtensionInfo('MP4')).toMatchObject({
      kind: 'video',
      mime: 'video/mp4',
    });
    expect(getExtensionInfo('jpg')?.kind).toBe('image');
    expect(getExtensionInfo('wav')?.kind).toBe('audio');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(getExtensionInfo('txt')).toBeUndefined();
    expect(getExtensionInfo('m4a')).toBeUndefined();
  });

  it('exposes the supported extension list', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining(['mp4', 'mov', 'jpg', 'jpeg', 'png', 'mp3', 'wav']),
    );
  });
});
