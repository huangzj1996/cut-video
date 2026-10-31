import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowRunStatus } from '@miaoma/video-project';
import type { ExportProgress, ExportState } from '../../shared/ipc-contract';
import { ProjectStore } from '../projects/project-store';
import type { ExportProcessRunner } from './runner';
import { ExportService, type ExportServiceOptions } from './service';
import {
  createExportFixture,
  EXPORT_TEST_FONTS,
  type ExportFixtureOptions,
} from './test-support/fixture';

let root: string;
let mediaRoot: string;
let store: ProjectStore;
let projectId: string;
let revision: number;

function writeMedia(): void {
  mediaRoot = path.join(root, 'media');
  mkdirSync(mediaRoot);

  for (const name of ['a.mp4', 'b.mp4', 'voice.m4a']) {
    writeFileSync(path.join(mediaRoot, name), 'fixture');
  }
}

function seedProject(options: ExportFixtureOptions = {}): { projectId: string; revision: number } {
  const created = store.create({ name: '夹具工程' });
  const id = created.project.projectId;
  const fixture = createExportFixture({
    audioPath: path.join(mediaRoot, 'voice.m4a'),
    videoPaths: [path.join(mediaRoot, 'a.mp4'), path.join(mediaRoot, 'b.mp4')],
    ...options,
  });
  const saved = store.update({
    expectedRevision: 0,
    projectId: id,
    project: { ...fixture, project: { ...fixture.project, projectId: id } },
  });

  return { projectId: id, revision: saved.project.contentRevision };
}

function createService(overrides: Partial<ExportServiceOptions> = {}): {
  progress: ExportProgress[];
  service: ExportService;
  states: ExportState[];
} {
  const states: ExportState[] = [];
  const progress: ExportProgress[] = [];
  const service = new ExportService({
    getExportFonts: () => EXPORT_TEST_FONTS,
    getProjectStore: () => store,
    getSettings: () => ({ defaultProjectDirectory: root }),
    getWorkflowStatus: () => null,
    media: () => ({ ffmpegAvailable: true, ffmpegPath: 'ffmpeg' }),
    onProgress: (event) => progress.push(event),
    onState: (event) => states.push(event),
    ...overrides,
  });

  return { progress, service, states };
}

function successRunner(): ExportProcessRunner {
  return async (request) => {
    const temporaryPath = request.args.at(-1);

    if (temporaryPath) {
      writeFileSync(temporaryPath, 'fake-mp4');
    }

    return { exitCode: 0, stderrTail: '' };
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'miaoma-export-service-'));
  writeMedia();
  store = new ProjectStore(path.join(root, 'projects'));
  const seeded = seedProject();
  projectId = seeded.projectId;
  revision = seeded.revision;
  mkdirSync(path.join(root, '导出'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function targetPath(): string {
  return path.join(root, '导出', '成片.mp4');
}

describe('export service', () => {
  it('runs the export job and emits the state sequence', async () => {
    const { progress, service, states } = createService({ createRunner: successRunner });
    const result = await service.start({
      expectedRevision: revision,
      projectId,
      targetPath: targetPath(),
    });

    await service.whenIdle();

    expect(states.map((state) => state.status + ':' + state.phase)).toEqual([
      'running:preparing',
      'running:validating',
      'running:mixing',
      'running:rendering',
      'running:committing',
      'succeeded:committing',
    ]);
    expect(progress.map((event) => event.phase)).toEqual([
      'validating',
      'mixing',
      'rendering',
      'committing',
    ]);
    expect(existsSync(targetPath())).toBe(true);
    expect(service.getOutputPath(result.runId)).toBe(targetPath());
  });

  it('rejects a stale content revision', async () => {
    const { service } = createService({ createRunner: successRunner });

    await expect(
      service.start({
        expectedRevision: revision - 1,
        projectId,
        targetPath: targetPath(),
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_PROJECT_STALE' });
  });

  it('rejects exports while the workflow holds the project readonly', async () => {
    const { service } = createService({
      createRunner: successRunner,
      getWorkflowStatus: () => 'running' as WorkflowRunStatus,
    });

    await expect(
      service.start({ expectedRevision: revision, projectId, targetPath: targetPath() }),
    ).rejects.toMatchObject({ code: 'EXPORT_PROJECT_READONLY_OR_DRAFT' });
  });

  it('rejects draft projects', async () => {
    const draft = store.create({ name: '草稿工程' });
    const { service } = createService({ createRunner: successRunner });

    await expect(
      service.start({
        expectedRevision: draft.project.contentRevision,
        projectId: draft.project.projectId,
        targetPath: targetPath(),
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_PROJECT_READONLY_OR_DRAFT' });
  });

  it('allows only one export at a time', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: ExportProcessRunner = async (request) => {
      await gate;
      const temporaryPath = request.args.at(-1);

      if (temporaryPath) {
        writeFileSync(temporaryPath, 'fake-mp4');
      }

      return { exitCode: 0, stderrTail: '' };
    };
    const { service } = createService({ createRunner: () => runner });

    await service.start({ expectedRevision: revision, projectId, targetPath: targetPath() });

    await expect(
      service.start({
        expectedRevision: revision,
        projectId,
        targetPath: path.join(root, '导出', 'second.mp4'),
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_ALREADY_RUNNING' });

    release();
    await service.whenIdle();
  });

  it('blocks export when preflight validation fails', async () => {
    const broken = seedProject({
      audioPath: 'C:/missing/voice.m4a',
      videoPaths: ['C:/missing/a.mp4', 'C:/missing/b.mp4'],
    });
    const { service } = createService({ createRunner: successRunner });

    await expect(
      service.start({
        expectedRevision: broken.revision,
        projectId: broken.projectId,
        targetPath: targetPath(),
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_VALIDATION_FAILED' });
  });

  it('blocks export when the bundled subtitle font is missing', async () => {
    const { service } = createService({
      createRunner: successRunner,
      getExportFonts: () => null,
    });

    await expect(
      service.start({ expectedRevision: revision, projectId, targetPath: targetPath() }),
    ).rejects.toMatchObject({ code: 'EXPORT_FONT_MISSING' });
  });

  it('blocks export when the target directory is not writable', async () => {
    const { service } = createService({ createRunner: successRunner });

    await expect(
      service.start({
        expectedRevision: revision,
        projectId,
        targetPath: path.join(root, 'missing', '成片.mp4'),
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_TARGET_UNWRITABLE' });
  });

  it('builds the default target from settings and the project name', () => {
    const { service } = createService();
    const target = service.getDefaultTarget(projectId);

    expect(target.directory).toBe(path.join(root, '导出'));
    expect(target.fileName.startsWith('夹具工程-')).toBe(true);
    expect(target.fileName.endsWith('.mp4')).toBe(true);
  });

  it('rejects reveal for an unknown or unfinished run', () => {
    const { service } = createService();

    expect(() => service.getOutputPath('unknown-run')).toThrow();
  });
});
