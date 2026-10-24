import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectAssets,
  type StoredProject,
  type VideoProject,
} from '@miaoma/video-project';
import { IpcError } from '../ipc-error';
import { ProjectStore } from './project-store';

let root: string;
let store: ProjectStore;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'miaoma-project-store-'));
  store = new ProjectStore(root);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function expectIpcError(callback: () => unknown, code: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(IpcError);
    expect((error as IpcError).code).toBe(code);
    return;
  }

  throw new Error(`Expected IpcError with code ${code}`);
}

function projectFile(projectId: string): string {
  return path.join(root, projectId, 'project.json');
}

function asVideoProject(project: StoredProject, runId = 'run-1'): VideoProject {
  return {
    ai: {
      inputFingerprint: 'fingerprint',
      model: 'deepseek-chat',
      modelConfigVersion: 'v1',
      provider: 'deepseek',
      runId,
      startedAt: '2026-10-24T00:00:00.000Z',
    },
    assets: project.assets,
    canvas: project.canvas,
    project: project.project,
    render: project.render,
    scenes: project.scenes,
    schemaVersion: project.schemaVersion,
    tracks: project.tracks,
  };
}

describe('ProjectStore', () => {
  it('creates a draft project file with schemaVersion', () => {
    const created = store.create({ name: '  测试项目  ' });

    expect(created.project.name).toBe('测试项目');
    expect(created.project.contentRevision).toBe(0);
    expect(created.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(created).not.toHaveProperty('ai');
    expect(created.scenes).toEqual([]);
    expect(created.tracks).toEqual([]);
    expect(created.assets).toEqual({
      music: [],
      subtitles: [],
      thumbnails: [],
      videos: [],
      voices: [],
    });

    expect(existsSync(projectFile(created.project.projectId))).toBe(true);
    const onDisk = JSON.parse(readFileSync(projectFile(created.project.projectId), 'utf8')) as {
      schemaVersion?: string;
    };
    expect(onDisk.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('lists project summaries sorted by updatedAt', async () => {
    const first = store.create({ name: '第一个项目' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = store.create({ name: '第二个项目' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.update({
      project: store.get(first.project.projectId),
      projectId: first.project.projectId,
    });

    const list = store.list();

    expect(list).toHaveLength(2);
    expect(list[0]?.projectId).toBe(first.project.projectId);
    expect(list.map((summary) => summary.schemaVersion)).toEqual([
      PROJECT_SCHEMA_VERSION,
      PROJECT_SCHEMA_VERSION,
    ]);
    expect(list.every((summary) => !('path' in summary))).toBe(true);
    expect(second.project.projectId).not.toBe(first.project.projectId);
  });

  it('updates content and increments contentRevision', () => {
    const created = store.create({ name: '旧名称' });
    const current = store.get(created.project.projectId);

    const updated = store.update({
      project: {
        ...current,
        project: {
          ...current.project,
          contentRevision: 99,
          name: '新名称',
          updatedAt: '2000-01-01T00:00:00.000Z',
        },
      },
      projectId: created.project.projectId,
    });

    expect(updated.project.name).toBe('新名称');
    expect(updated.project.contentRevision).toBe(1);
    expect(updated.project.createdAt).toBe(created.project.createdAt);
    expect(updated.project.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(store.get(created.project.projectId)).toEqual(updated);
    expect(readdirSync(path.dirname(projectFile(created.project.projectId)))).toEqual([
      'project.json',
    ]);
  });

  it('writes and reads creation input', () => {
    const created = store.create({ name: '创作项目' });

    const input = store.writeCreationInput(created.project.projectId, {
      script: '  一段口播文稿。  ',
      voicePresetId: 'wenrou-xuejie',
    });

    expect(input.script).toBe('一段口播文稿。');
    expect(input.projectId).toBe(created.project.projectId);
    expect(store.readCreationInput(created.project.projectId)).toEqual(input);
    expect(existsSync(path.join(root, created.project.projectId, 'inputs', 'creation.json'))).toBe(
      true,
    );
  });

  it('exposes the project directory internally', () => {
    const created = store.create({ name: '目录项目' });

    expect(store.getProjectDirectory(created.project.projectId)).toBe(
      path.join(root, created.project.projectId),
    );
    expectIpcError(() => store.getProjectDirectory('missing-project'), 'PROJECT_NOT_FOUND');
  });

  it('saves a generated project at the expected revision and is idempotent', () => {
    const created = store.create({ name: '生成项目' });
    const project = asVideoProject(store.get(created.project.projectId));

    const saved = store.saveGeneratedProject(created.project.projectId, project, 1);

    expect('ai' in saved).toBe(true);
    expect(saved.project.contentRevision).toBe(1);
    expect(saved.project.createdAt).toBe(created.project.createdAt);
    expect(store.list()[0]?.isDraft).toBe(false);

    const repeated = store.saveGeneratedProject(created.project.projectId, project, 1);
    expect(repeated.project.contentRevision).toBe(1);

    expectIpcError(
      () => store.saveGeneratedProject(created.project.projectId, project, 3),
      'PROJECT_STALE_REVISION',
    );
  });

  it('marks drafts in project summaries', () => {
    store.create({ name: '草稿项目' });

    expect(store.list()[0]?.isDraft).toBe(true);
  });

  it('creates a project with initial assets', () => {
    const assets = {
      music: [],
      subtitles: [],
      thumbnails: [],
      videos: [
        {
          durationMs: 1000,
          fps: 30,
          height: 1080,
          id: 'asset-video-1',
          mediaType: 'video' as const,
          path: 'C:/media/clip.mp4',
          thumbnailIds: [],
          width: 1920,
        },
      ],
      voices: [],
    };

    const created = store.create({ name: '带素材项目' }, { assets });

    expect(store.get(created.project.projectId).assets).toEqual(assets);
  });

  it('replaces creation-time assets without changing contentRevision', () => {
    const created = store.create({ name: '关键帧项目' });
    const assets: ProjectAssets = {
      music: [],
      subtitles: [],
      thumbnails: [
        {
          height: 432,
          id: 'thumb-1',
          path: 'C:/project/cache/keyframes/aa/frame-00-2500ms.jpg',
          timeMs: 2500,
          width: 768,
        },
      ],
      videos: [
        {
          durationMs: 5000,
          fps: 30,
          height: 1080,
          id: 'asset-video-1',
          mediaType: 'video',
          path: 'C:/media/clip.mp4',
          thumbnailIds: ['thumb-1'],
          width: 1920,
        },
      ],
      voices: [],
    };

    const updated = store.replaceAssets(created.project.projectId, assets);

    expect(updated.project.contentRevision).toBe(0);
    expect(updated.project.updatedAt).toBe(created.project.updatedAt);
    expect(store.get(created.project.projectId).assets).toEqual(assets);
  });

  it('returns the keyframe cache directory inside the project', () => {
    const created = store.create({ name: '缓存项目' });
    const projectId = created.project.projectId;

    expect(store.getKeyframeCacheDirectory(projectId)).toBe(
      path.join(root, projectId, 'cache', 'keyframes'),
    );
    expectIpcError(() => store.getKeyframeCacheDirectory('missing-project'), 'PROJECT_NOT_FOUND');
    expectIpcError(() => store.getKeyframeCacheDirectory('../escape'), 'PROJECT_INVALID_ARGUMENT');
  });

  it('deletes a project directory', () => {
    const created = store.create({ name: '待删除' });

    expect(store.delete(created.project.projectId)).toEqual({
      deleted: true,
      projectId: created.project.projectId,
    });
    expect(existsSync(path.join(root, created.project.projectId))).toBe(false);
    expectIpcError(() => store.get(created.project.projectId), 'PROJECT_NOT_FOUND');
  });

  it('rejects invalid project ids before touching the filesystem', () => {
    expectIpcError(() => store.get('../escape'), 'PROJECT_INVALID_ARGUMENT');
    expectIpcError(() => store.delete('..\\escape'), 'PROJECT_INVALID_ARGUMENT');
    expectIpcError(() => store.get('a/b'), 'PROJECT_INVALID_ARGUMENT');
    expectIpcError(() => store.get('CON'), 'PROJECT_INVALID_ARGUMENT');
  });

  it('rejects invalid names', () => {
    expectIpcError(() => store.create({ name: '   ' }), 'PROJECT_INVALID_ARGUMENT');
    expectIpcError(() => store.create({ name: 'x'.repeat(121) }), 'PROJECT_INVALID_ARGUMENT');
  });

  it('returns PROJECT_NOT_FOUND for missing projects', () => {
    expectIpcError(() => store.get('missing-project'), 'PROJECT_NOT_FOUND');
    expectIpcError(() => store.delete('missing-project'), 'PROJECT_NOT_FOUND');
  });

  it('refuses to update with a mismatched project id', () => {
    const first = store.create({ name: 'A' });
    const second = store.create({ name: 'B' });

    expectIpcError(
      () =>
        store.update({
          project: store.get(second.project.projectId),
          projectId: first.project.projectId,
        }),
      'PROJECT_INVALID_ARGUMENT',
    );
  });

  it('skips corrupt project directories in list', () => {
    const good = store.create({ name: '正常项目' });
    const corrupt = store.create({ name: '损坏项目' });
    writeFileSync(projectFile(corrupt.project.projectId), '{not json', 'utf8');

    expect(store.list().map((summary) => summary.projectId)).toEqual([good.project.projectId]);
    expectIpcError(() => store.get(corrupt.project.projectId), 'PROJECT_READ_FAILED');
  });

  it('refuses unsupported schema versions instead of overwriting', () => {
    const created = store.create({ name: '未来版本' });
    const current = store.get(created.project.projectId);
    const file = projectFile(created.project.projectId);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    raw.schemaVersion = '2.0.0';
    writeFileSync(file, JSON.stringify(raw), 'utf8');

    expectIpcError(() => store.get(created.project.projectId), 'PROJECT_SCHEMA_UNSUPPORTED');

    const futureProject = {
      ...current,
      schemaVersion: '2.0.0',
    } as unknown as StoredProject;
    expectIpcError(
      () =>
        store.update({
          project: futureProject,
          projectId: created.project.projectId,
        }),
      'PROJECT_SCHEMA_UNSUPPORTED',
    );
  });
});
