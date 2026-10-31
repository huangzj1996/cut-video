import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertExportTargetPath,
  buildDefaultExportTarget,
  formatExportTimestamp,
  partialPathFor,
  sanitizeExportFileName,
} from './target';

describe('export target helpers', () => {
  it('keeps Chinese names and replaces Windows-invalid characters', () => {
    expect(sanitizeExportFileName('成片:第一版?')).toBe('成片-第一版-');
    expect(sanitizeExportFileName('   ')).toBe('未命名工程');
    expect(sanitizeExportFileName('a/b\\c')).toBe('a-b-c');
  });

  it('formats a local yyyyMMdd-HHmmss timestamp', () => {
    expect(formatExportTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });

  it('builds the default target under the 导出 directory and suffixes duplicates', () => {
    const projectRoot = 'C:\\root';
    const directory = path.join(projectRoot, '导出');
    const firstName = '夹具工程-20260102-030405.mp4';
    const exists = new Set([path.join(directory, firstName)]);

    const target = buildDefaultExportTarget({
      exists: (candidate) => exists.has(candidate),
      now: new Date(2026, 0, 2, 3, 4, 5),
      projectName: '夹具工程',
      projectRoot,
    });

    expect(target.directory).toBe(directory);
    expect(target.fileName).toBe('夹具工程-20260102-030405-1.mp4');
    expect(target.path).toBe(path.join(directory, target.fileName));
  });

  it('resolves a relative mp4 target and rejects other extensions', () => {
    expect(assertExportTargetPath('./out/成片.mp4')).toBe(path.resolve('out/成片.mp4'));
    expect(() => assertExportTargetPath('C:/out/成片.mov')).toThrow();
    expect(() => assertExportTargetPath('   ')).toThrow();
  });

  it('uses a .partial sibling for the temporary file', () => {
    expect(partialPathFor('C:/out/成片.mp4')).toBe('C:/out/成片.mp4.partial');
  });
});
