import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ValidationReport } from '@miaoma/video-project';
import { validateExportPreflight } from './preflight';
import { createExportFixture } from './test-support/fixture';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'miaoma-export-preflight-'));
  roots.push(root);
  return root;
}

function report(passed: boolean, errors: ValidationReport['errors'] = []): ValidationReport {
  return {
    errors,
    passed,
    projectId: 'project-fixture',
    reportVersion: 1,
    schemaVersion: '1.0.0',
    validatedAt: '2026-01-01T00:00:00.000Z',
    validatedRevision: 1,
    warnings: [],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('export preflight', () => {
  it('passes when validation passes and the target directory is writable', () => {
    const root = tempRoot();
    const targetPath = path.join(root, '成片.mp4');
    const error = validateExportPreflight(
      { ffmpegAvailable: true, project: createExportFixture(), targetPath },
      { validate: () => report(true) },
    );

    expect(error).toBeNull();
  });

  it('blocks export when ffmpeg is unavailable', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      {
        ffmpegAvailable: false,
        project: createExportFixture(),
        targetPath: path.join(root, '成片.mp4'),
      },
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_RENDER_FAILED');
  });

  it('blocks export when the target directory does not exist', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      {
        ffmpegAvailable: true,
        project: createExportFixture(),
        targetPath: path.join(root, 'missing', '成片.mp4'),
      },
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_TARGET_UNWRITABLE');
  });

  it('reports validation errors with the original issue locations', () => {
    const root = tempRoot();
    const issue = {
      assetId: 'video-a',
      clipId: 'clip-1',
      code: 'ASSET_FILE_MISSING',
      message: '视频素材文件不存在或已被移动。',
      severity: 'error' as const,
    };
    const error = validateExportPreflight(
      {
        ffmpegAvailable: true,
        project: createExportFixture(),
        targetPath: path.join(root, '成片.mp4'),
      },
      { validate: () => report(false, [issue]) },
    );

    expect(error?.code).toBe('EXPORT_VALIDATION_FAILED');
    expect(error?.issues).toEqual([
      {
        assetId: 'video-a',
        clipId: 'clip-1',
        code: 'ASSET_FILE_MISSING',
        message: '视频素材文件不存在或已被移动。',
      },
    ]);
  });

  it('rejects a target path that is an existing directory', () => {
    const root = tempRoot();
    const targetPath = path.join(root, '成片.mp4');
    mkdirSync(targetPath);
    const error = validateExportPreflight(
      { ffmpegAvailable: true, project: createExportFixture(), targetPath },
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_TARGET_UNWRITABLE');
  });

  it('runs the real business validation against existing media files', () => {
    const root = tempRoot();
    const media = path.join(root, 'media');
    mkdirSync(media);
    const a = path.join(media, 'a.mp4');
    const b = path.join(media, 'b.mp4');
    const voice = path.join(media, 'voice.m4a');

    for (const filePath of [a, b, voice]) {
      writeFileSync(filePath, 'fixture');
    }

    const project = createExportFixture({ audioPath: voice, videoPaths: [a, b] });
    const error = validateExportPreflight({
      ffmpegAvailable: true,
      project,
      targetPath: path.join(root, '成片.mp4'),
    });

    expect(error).toBeNull();
  });
});
