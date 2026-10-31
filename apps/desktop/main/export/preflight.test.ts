import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DraftProject,
  ValidationReport,
  VideoAsset,
  VideoClip,
  VideoProject,
} from '@miaoma/video-project';
import { validateExportPreflight, type ExportPreflightInput } from './preflight';
import { createExportFixture, EXPORT_TEST_FONTS } from './test-support/fixture';

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

interface PreflightOverrides {
  expectedRevision?: number;
  ffmpegAvailable?: boolean;
  fonts?: ExportPreflightInput['fonts'];
  workflowStatus?: ExportPreflightInput['workflowStatus'];
}

function preflightInput(
  project: VideoProject | DraftProject,
  targetPath: string,
  overrides: PreflightOverrides = {},
): ExportPreflightInput {
  return {
    expectedRevision: project.project.contentRevision,
    ffmpegAvailable: true,
    fonts: EXPORT_TEST_FONTS,
    project,
    targetPath,
    workflowStatus: null,
    ...overrides,
  };
}

function asDraft(project: VideoProject): DraftProject {
  const { ai: _ai, ...draft } = project;

  return draft as DraftProject;
}

/** 给视频素材打补丁：指定 assetId 时只改那一个，否则改所有视频素材。 */
function withVideoAssets(
  project: VideoProject,
  patch: Partial<VideoAsset>,
  assetId?: string,
): VideoProject {
  return {
    ...project,
    assets: {
      ...project.assets,
      videos: project.assets.videos.map((asset) => {
        const matches = assetId === undefined ? asset.mediaType === 'video' : asset.id === assetId;

        return matches ? { ...asset, ...patch } : asset;
      }),
    },
  };
}

function withVideoClips(project: VideoProject, patch: Partial<VideoClip>): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.kind === 'video'
        ? { ...track, clips: track.clips.map((clip) => ({ ...clip, ...patch })) }
        : track,
    ),
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
    const project = createExportFixture();
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error).toBeNull();
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
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')));

    expect(error).toBeNull();
  });

  it('blocks export when ffmpeg is unavailable', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      preflightInput(createExportFixture(), path.join(root, '成片.mp4'), {
        ffmpegAvailable: false,
      }),
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_RENDER_FAILED');
  });

  it('blocks export when the bundled subtitle font is missing', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      preflightInput(createExportFixture({ subtitle: {} }), path.join(root, '成片.mp4'), {
        fonts: null,
      }),
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_FONT_MISSING');
  });

  it('blocks export when the target directory does not exist', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      preflightInput(createExportFixture(), path.join(root, 'missing', '成片.mp4')),
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_TARGET_UNWRITABLE');
  });

  it('blocks when the target directory exists but is not writable', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      preflightInput(createExportFixture(), path.join(root, '成片.mp4')),
      { isDirectoryWritable: () => false, validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_TARGET_UNWRITABLE');
  });

  it('rejects a target path that is an existing directory', () => {
    const root = tempRoot();
    const targetPath = path.join(root, '成片.mp4');
    mkdirSync(targetPath);
    const error = validateExportPreflight(preflightInput(createExportFixture(), targetPath), {
      validate: () => report(true),
    });

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
      preflightInput(createExportFixture(), path.join(root, '成片.mp4')),
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

  it('blocks draft projects before running business validation', () => {
    const root = tempRoot();
    let validateCalls = 0;
    const error = validateExportPreflight(
      preflightInput(asDraft(createExportFixture()), path.join(root, '成片.mp4')),
      {
        validate: () => {
          validateCalls += 1;
          return report(true);
        },
      },
    );

    expect(error?.code).toBe('EXPORT_PROJECT_READONLY_OR_DRAFT');
    expect(validateCalls).toBe(0);
  });

  it('blocks exports while the workflow holds the project readonly', () => {
    const root = tempRoot();
    const project = createExportFixture();

    for (const workflowStatus of ['running', 'waiting_user'] as const) {
      const error = validateExportPreflight(
        preflightInput(project, path.join(root, '成片.mp4'), { workflowStatus }),
        { validate: () => report(true) },
      );

      expect(error?.code).toBe('EXPORT_PROJECT_READONLY_OR_DRAFT');
    }
  });

  it('allows exports once the workflow is no longer running', () => {
    const root = tempRoot();
    const project = createExportFixture();

    for (const workflowStatus of [
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
      'pending',
    ] as const) {
      const error = validateExportPreflight(
        preflightInput(project, path.join(root, '成片.mp4'), { workflowStatus }),
        { validate: () => report(true) },
      );

      expect(error).toBeNull();
    }
  });

  it('blocks a stale expected revision', () => {
    const root = tempRoot();
    const project = createExportFixture();
    const error = validateExportPreflight(
      preflightInput(project, path.join(root, '成片.mp4'), {
        expectedRevision: project.project.contentRevision - 1,
      }),
      { validate: () => report(true) },
    );

    expect(error?.code).toBe('EXPORT_PROJECT_STALE');
  });

  it('re-validates the current revision on every call instead of reusing a report', () => {
    const root = tempRoot();
    const project = createExportFixture();
    let validateCalls = 0;
    const deps = {
      validate: () => {
        validateCalls += 1;
        return report(true);
      },
    };

    validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), deps);
    validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), deps);

    expect(validateCalls).toBe(2);
  });

  it('blocks unsupported HEVC media with asset, clip and scene locations', () => {
    const root = tempRoot();
    const project = withVideoAssets(createExportFixture(), { codec: 'hevc' });
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error?.code).toBe('EXPORT_UNSUPPORTED_MEDIA');
    expect(error?.issues?.[0]).toMatchObject({
      assetId: 'video-a',
      clipId: 'clip-1',
      code: 'EXPORT_UNSUPPORTED_MEDIA',
      sceneId: 'scene-1',
    });
    expect(error?.issues?.[0]?.message).toContain('H.264');
    expect(error?.issues).toHaveLength(2);
  });

  it('blocks HDR media with a reason the user can act on', () => {
    const root = tempRoot();
    const project = withVideoAssets(createExportFixture(), { isHdr: true });
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error?.code).toBe('EXPORT_UNSUPPORTED_MEDIA');
    expect(error?.issues?.[0]?.message).toContain('SDR');
  });

  it('blocks VFR media with a reason the user can act on', () => {
    const root = tempRoot();
    const project = withVideoAssets(createExportFixture(), { isVfr: true });
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error?.code).toBe('EXPORT_UNSUPPORTED_MEDIA');
    expect(error?.issues?.[0]?.message).toContain('VFR');
  });

  it('allows media recorded before the codec field existed', () => {
    const root = tempRoot();
    const error = validateExportPreflight(
      preflightInput(createExportFixture(), path.join(root, '成片.mp4')),
      { validate: () => report(true) },
    );

    expect(error).toBeNull();
  });

  it('blocks non-default crop with the clip and scene locations', () => {
    const root = tempRoot();
    const project = withVideoClips(createExportFixture(), {
      crop: { height: 1, width: 0.5, x: 0.25, y: 0 },
    });
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error?.code).toBe('EXPORT_UNSUPPORTED_TRANSFORM');
    expect(error?.issues?.[0]).toMatchObject({
      assetId: 'video-a',
      clipId: 'clip-1',
      code: 'EXPORT_UNSUPPORTED_TRANSFORM',
      sceneId: 'scene-1',
    });
    expect(error?.issues?.[0]?.message).toContain('裁剪');
  });

  it('blocks non-default transform with the clip and scene locations', () => {
    const root = tempRoot();
    const project = withVideoClips(createExportFixture(), {
      transform: { scale: 1.2, x: 0, y: 0 },
    });
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error?.code).toBe('EXPORT_UNSUPPORTED_TRANSFORM');
    expect(error?.issues?.[0]?.message).toContain('变换');
  });

  it('reports media and transform capability problems together', () => {
    const root = tempRoot();
    const mediaProblem = withVideoAssets(createExportFixture(), { codec: 'hevc' });
    const project = withVideoClips(mediaProblem, {
      crop: { height: 1, width: 0.5, x: 0.25, y: 0 },
    });
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error?.code).toBe('EXPORT_UNSUPPORTED_MEDIA');
    expect(error?.issues?.map((issue) => issue.code)).toContain('EXPORT_UNSUPPORTED_MEDIA');
    expect(error?.issues?.map((issue) => issue.code)).toContain('EXPORT_UNSUPPORTED_TRANSFORM');
    expect(error?.issues?.some((issue) => issue.fieldPath === 'crop')).toBe(true);
  });

  it('keeps image assets out of the video capability boundary', () => {
    const root = tempRoot();
    const project = withVideoAssets(
      createExportFixture({ firstMediaType: 'image' }),
      {
        codec: 'hevc',
        isHdr: true,
        isVfr: true,
      },
      'video-a',
    );
    const error = validateExportPreflight(preflightInput(project, path.join(root, '成片.mp4')), {
      validate: () => report(true),
    });

    expect(error).toBeNull();
  });
});
