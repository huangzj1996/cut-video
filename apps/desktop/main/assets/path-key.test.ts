import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInside, isSamePath, pathDepth, toPathKey } from './path-key';

describe('path-key', () => {
  it('normalizes dot segments and trailing separators', () => {
    const base = path.resolve('assets', 'clips');

    expect(toPathKey(`${base}${path.sep}.${path.sep}`)).toBe(toPathKey(base));
    expect(toPathKey(`${base}${path.sep}..${path.sep}clips`)).toBe(toPathKey(base));
  });

  it('treats equivalent paths as the same path', () => {
    const base = path.resolve('assets');

    expect(isSamePath(base, `${base}${path.sep}`)).toBe(true);
    expect(isSamePath(base, path.join(base, 'nested'))).toBe(false);
  });

  it('detects nested paths', () => {
    const parent = path.resolve('assets');
    const child = path.join(parent, 'nested');

    expect(isPathInside(parent, child)).toBe(true);
    expect(isPathInside(child, parent)).toBe(false);
    expect(isPathInside(parent, parent)).toBe(false);
  });

  it('counts path depth', () => {
    const parent = path.resolve('assets');

    expect(pathDepth(path.join(parent, 'nested'))).toBe(pathDepth(parent) + 1);
  });

  it.runIf(process.platform === 'win32')('lowercases Windows paths', () => {
    expect(toPathKey('C:\\Media\\Clip.MP4')).toBe(toPathKey('c:\\media\\clip.mp4'));
  });
});
