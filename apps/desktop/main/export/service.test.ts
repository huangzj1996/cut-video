import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowRunStatus } from '@miaoma/video-project';
import type { ExportProgress, ExportState } from '../../shared/ipc-contract';
import { ProjectStore } from '../projects/project-store';
import type { ExportProcessRequest, ExportProcessRunner } from './runner';
import { ExportService, type ExportServiceOptions } from './service';
import { createFakeProcess, okProcess, type FakeProcess } from './test-support/fake-process';
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

function workspaceRoot(): string {
  return path.join(root, 'temp', 'miaoma-export-workspaces');
}

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
    exportTempRoot: path.join(root, 'temp'),
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

function requireProcess(value: FakeProcess | null): FakeProcess {
  if (value === null) {
    throw new Error('渲染进程应该已经启动');
  }

  return value;
}

function writeLastArg(request: ExportProcessRequest): void {
  const outputPath = request.args.at(-1);

  if (outputPath) {
    writeFileSync(outputPath, 'fake-mp4');
  }
}

function successRunner(): ExportProcessRunner {
  return (request) => {
    writeLastArg(request);

    return createFakeProcess({ autoExit: okProcess() });
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
  mkdirSync(path.join(root, 'temp'), { recursive: true });
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
    // 正常完成后临时工作区（以及登记文件）必须被清掉。
    expect(readdirSync(workspaceRoot())).toEqual([]);
  });

  it('emits real rendering progress with percent, elapsed time and ETA', async () => {
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (request.args.at(-1) === path.join(root, '导出', '成片.mp4.partial')) {
        request.onStdoutChunk?.('out_time_us=1000000\nspeed=2.0x\nprogress=continue\n');
        request.onStdoutChunk?.('out_time_us=2000000\nspeed=2.0x\nprogress=end\n');
      }

      return createFakeProcess({ autoExit: okProcess() });
    };
    const { progress, service } = createService({ createRunner: () => runner });

    await service.start({ expectedRevision: revision, projectId, targetPath: targetPath() });
    await service.whenIdle();

    const rendered = progress.filter(
      (event) => event.phase === 'rendering' && event.percent !== null,
    );

    expect(rendered.map((event) => event.percent)).toEqual([50, 100]);
    expect(rendered[0]?.etaMs).toBe(500);
    expect(rendered[0]?.speed).toBe(2);
    expect(rendered[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(rendered[0]?.renderedMediaMs).toBe(1_000);
  });

  it('cancels the active export, cleans temp artifacts and allows an immediate restart', async () => {
    let manualRender = true;
    let markRenderStarted: () => void = () => undefined;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    let renderProcess: FakeProcess | null = null;
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (!manualRender) {
        return createFakeProcess({ autoExit: okProcess() });
      }

      if (request.args.at(-1) === path.join(root, '导出', '成片.mp4.partial.wav')) {
        return createFakeProcess({ autoExit: okProcess() });
      }

      renderProcess = createFakeProcess({ exitOnQuit: { exitCode: 0, stderrTail: '' } });
      markRenderStarted();

      return renderProcess;
    };
    const { service, states } = createService({ createRunner: () => runner });

    const result = await service.start({
      expectedRevision: revision,
      projectId,
      targetPath: targetPath(),
    });

    await renderStarted;
    expect(service.hasActive()).toBe(true);
    service.cancel(result.runId);

    expect(requireProcess(renderProcess).quitCount).toBe(1);
    await service.whenIdle();

    expect(states.at(-1)).toMatchObject({ phase: 'rendering', status: 'cancelled' });
    expect(states.at(-1)?.error?.code).toBe('EXPORT_CANCELLED');
    expect(existsSync(targetPath())).toBe(false);
    expect(readdirSync(workspaceRoot())).toEqual([]);

    // 取消后可以立刻再次导出，不会被上一次任务挡住。
    manualRender = false;
    const second = await service.start({
      expectedRevision: revision,
      projectId,
      targetPath: targetPath(),
    });
    await service.whenIdle();

    expect(second.runId).not.toBe(result.runId);
    expect(states.at(-1)).toMatchObject({ status: 'succeeded' });
    expect(existsSync(targetPath())).toBe(true);
  });

  it('treats cancel for an unknown or finished run as a no-op', async () => {
    const { service, states } = createService({ createRunner: successRunner });

    expect(service.cancel('unknown-run')).toBeNull();

    await service.start({ expectedRevision: revision, projectId, targetPath: targetPath() });
    await service.whenIdle();

    const before = states.length;

    expect(service.cancel('unknown-run')).toBeNull();
    expect(service.hasActive()).toBe(false);
    expect(states).toHaveLength(before);
  });

  it('keeps the renderer stderr tail as an expandable failure detail', async () => {
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      return createFakeProcess({
        autoExit:
          request.args.at(-1) === path.join(root, '导出', '成片.mp4.partial.wav')
            ? okProcess()
            : { exitCode: 1, stderrTail: 'Unknown filter ass' },
      });
    };
    const { service, states } = createService({ createRunner: () => runner });

    await service.start({ expectedRevision: revision, projectId, targetPath: targetPath() });
    await service.whenIdle();

    expect(states.at(-1)).toMatchObject({ status: 'failed' });
    expect(states.at(-1)?.error?.detail).toContain('Unknown filter ass');
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
    const runner: ExportProcessRunner = (request) => {
      const fake = createFakeProcess();

      void gate.then(() => {
        writeLastArg(request);
        fake.resolve(okProcess());
      });

      return fake;
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

  it('blocks unsupported media with locatable issues before rendering', async () => {
    const hevc = seedProject({ videoCodec: 'hevc' });
    const { service } = createService({ createRunner: successRunner });

    await expect(
      service.start({
        expectedRevision: hevc.revision,
        projectId: hevc.projectId,
        targetPath: targetPath(),
      }),
    ).rejects.toMatchObject({
      code: 'EXPORT_UNSUPPORTED_MEDIA',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ assetId: 'video-a', clipId: 'clip-1', sceneId: 'scene-1' }),
        ]),
      },
    });
  });

  it('blocks non-default crop/transform before rendering', async () => {
    const transformed = seedProject({
      crop: { height: 1, width: 0.5, x: 0.25, y: 0 },
      transform: { scale: 1.2, x: 0, y: 0 },
    });
    const { service } = createService({ createRunner: successRunner });

    await expect(
      service.start({
        expectedRevision: transformed.revision,
        projectId: transformed.projectId,
        targetPath: targetPath(),
      }),
    ).rejects.toMatchObject({
      code: 'EXPORT_UNSUPPORTED_TRANSFORM',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ clipId: 'clip-1', sceneId: 'scene-1' }),
        ]),
      },
    });
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
