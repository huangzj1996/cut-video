import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  PROJECT_SCHEMA_VERSION,
  StoredProjectSchema,
  type ProjectAssets,
  type StoredProject,
} from '@miaoma/video-project';
import type {
  ProjectCreateInput,
  ProjectDeleteResult,
  ProjectSummary,
  ProjectUpdateInput,
} from '../../shared/ipc-contract';
import type { AssetSelectionManifest } from '../assets/asset-manifest';
import { IpcError } from '../ipc-error';

const PROJECT_DIRECTORY_FILE = 'project.json';
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SCHEMA_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_REPORTED_ISSUES = 10;

interface ProjectIssue {
  message: string;
  path: string;
}

function toProjectIssues(error: {
  issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>;
}): ProjectIssue[] {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
    message: issue.message,
    path: issue.path.map((segment) => String(segment)).join('.'),
  }));
}

function toSummary(project: StoredProject): ProjectSummary {
  return {
    contentRevision: project.project.contentRevision,
    createdAt: project.project.createdAt,
    name: project.project.name,
    projectId: project.project.projectId,
    schemaVersion: project.schemaVersion,
    updatedAt: project.project.updatedAt,
  };
}

function createEmptyAssets(): ProjectAssets {
  return {
    music: [],
    subtitles: [],
    thumbnails: [],
    videos: [],
    voices: [],
  };
}

function createDraftProject(
  projectId: string,
  name: string,
  now: string,
  assets: ProjectAssets = createEmptyAssets(),
): StoredProject {
  return {
    assets,
    canvas: {
      aspectRatio: '16:9',
      fps: 30,
      height: 1080,
      width: 1920,
    },
    project: {
      contentRevision: 0,
      createdAt: now,
      name,
      projectId,
      updatedAt: now,
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
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracks: [],
  };
}

/**
 * 项目文件仓库。
 *
 * 目录结构：`<root>/<projectId>/project.json`
 * - 写入先写临时文件再 rename，避免半截文件覆盖上一份有效工程。
 * - 所有读写都在 root 内完成，projectId 经过白名单校验，防止路径穿越。
 * - 不向渲染进程返回文件系统路径或原始异常。
 */
export class ProjectStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  list(): ProjectSummary[] {
    try {
      if (!existsSync(this.rootDirectory)) {
        return [];
      }

      const summaries: ProjectSummary[] = [];

      for (const entry of readdirSync(this.rootDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !PROJECT_ID_PATTERN.test(entry.name)) {
          continue;
        }

        try {
          const project = this.readProject(entry.name);
          if (project.project.projectId !== entry.name) {
            continue;
          }
          summaries.push(toSummary(project));
        } catch {
          // 损坏、缺失或版本不兼容的工程不阻断列表查询。
        }
      }

      return summaries.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.projectId.localeCompare(right.projectId),
      );
    } catch {
      throw new IpcError('PROJECT_LIST_FAILED', '读取项目列表失败。', true);
    }
  }

  get(rawProjectId: string): StoredProject {
    return this.readProject(this.parseProjectId(rawProjectId));
  }

  create(rawInput: ProjectCreateInput, options: { assets?: ProjectAssets } = {}): StoredProject {
    const name = this.parseProjectName((rawInput as { name?: unknown } | undefined)?.name);
    const now = new Date().toISOString();
    const project = createDraftProject(
      randomUUID(),
      name,
      now,
      options.assets ?? createEmptyAssets(),
    );

    this.writeProject(project.project.projectId, project);
    return project;
  }

  update(rawInput: ProjectUpdateInput): StoredProject {
    const input = rawInput as { project?: unknown; projectId?: unknown } | undefined;
    const projectId = this.parseProjectId(input?.projectId);
    const existing = this.readProject(projectId);
    const rawProject = input?.project;

    if (rawProject === null || typeof rawProject !== 'object') {
      throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目内容无效。');
    }

    this.assertSupportedSchemaVersion(rawProject);

    const parsed = StoredProjectSchema.safeParse(rawProject);
    if (!parsed.success) {
      throw new IpcError('PROJECT_INVALID', '项目内容结构无效。', false, {
        issues: toProjectIssues(parsed.error),
      });
    }

    if (parsed.data.project.projectId !== projectId) {
      throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目 ID 与内容不一致。');
    }

    const updated = StoredProjectSchema.parse({
      ...parsed.data,
      project: {
        ...parsed.data.project,
        contentRevision: existing.project.contentRevision + 1,
        createdAt: existing.project.createdAt,
        updatedAt: new Date().toISOString(),
      },
      schemaVersion: PROJECT_SCHEMA_VERSION,
    });

    this.writeProject(projectId, updated);
    return updated;
  }

  delete(rawProjectId: string): ProjectDeleteResult {
    const projectId = this.parseProjectId(rawProjectId);
    const directory = this.projectDirectory(projectId);

    if (!existsSync(path.join(directory, PROJECT_DIRECTORY_FILE))) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在。');
    }

    try {
      rmSync(directory, { force: true, recursive: true });
    } catch {
      throw new IpcError('PROJECT_DELETE_FAILED', '删除项目失败。', true);
    }

    return { deleted: true, projectId };
  }

  /**
   * 持久化创建页选中的素材清单。清单只供主进程/后续探测使用，
   * 不通过 IPC 返回给渲染进程。
   */
  writeAssetManifest(projectId: string, manifest: AssetSelectionManifest): void {
    const directory = this.projectDirectory(projectId);

    if (!existsSync(path.join(directory, PROJECT_DIRECTORY_FILE))) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在。');
    }

    const inputsDirectory = path.join(directory, 'inputs');
    const target = path.join(inputsDirectory, 'assets.json');
    const temporary = path.join(inputsDirectory, `.assets.json.${randomUUID()}.tmp`);

    try {
      mkdirSync(inputsDirectory, { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      renameSync(temporary, target);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // 清理失败不影响主错误。
      }
      throw new IpcError('ASSET_MANIFEST_WRITE_FAILED', '保存素材清单失败。', true);
    }
  }

  private readProject(projectId: string): StoredProject {
    const filePath = path.join(this.projectDirectory(projectId), PROJECT_DIRECTORY_FILE);
    let raw: string;

    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在。');
      }
      throw new IpcError('PROJECT_READ_FAILED', '读取项目失败。', true);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new IpcError('PROJECT_READ_FAILED', '项目文件不是有效的 JSON。');
    }

    if (parsed === null || typeof parsed !== 'object') {
      throw new IpcError('PROJECT_READ_FAILED', '项目文件结构无效。');
    }

    this.assertSupportedSchemaVersion(parsed);

    const result = StoredProjectSchema.safeParse(parsed);
    if (!result.success) {
      throw new IpcError('PROJECT_INVALID', '项目文件结构无效。', false, {
        issues: toProjectIssues(result.error),
      });
    }

    return result.data;
  }

  private writeProject(projectId: string, project: StoredProject): void {
    const directory = this.projectDirectory(projectId);
    const target = path.join(directory, PROJECT_DIRECTORY_FILE);
    const temporary = path.join(directory, `.${PROJECT_DIRECTORY_FILE}.${randomUUID()}.tmp`);

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      renameSync(temporary, target);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // 清理失败不影响主错误；临时文件位于工程目录内，下一次写入会继续使用新文件名。
      }
      throw new IpcError('PROJECT_WRITE_FAILED', '写入项目失败。', true);
    }
  }

  private assertSupportedSchemaVersion(project: object): void {
    const schemaVersion = (project as { schemaVersion?: unknown }).schemaVersion;

    if (typeof schemaVersion !== 'string' || !SCHEMA_VERSION_PATTERN.test(schemaVersion)) {
      throw new IpcError('PROJECT_SCHEMA_UNSUPPORTED', '项目缺少有效的 schemaVersion。');
    }

    if (schemaVersion !== PROJECT_SCHEMA_VERSION) {
      throw new IpcError(
        'PROJECT_SCHEMA_UNSUPPORTED',
        `项目 schemaVersion ${schemaVersion} 与当前应用不兼容。`,
      );
    }
  }

  private parseProjectId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !PROJECT_ID_PATTERN.test(value) ||
      WINDOWS_RESERVED_NAME_PATTERN.test(value)
    ) {
      throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目 ID 无效。');
    }

    return value;
  }

  private parseProjectName(value: unknown): string {
    if (typeof value !== 'string') {
      throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目名称无效。');
    }

    const name = value.trim();

    if (name.length === 0 || name.length > MAX_PROJECT_NAME_LENGTH) {
      throw new IpcError(
        'PROJECT_INVALID_ARGUMENT',
        `项目名称需为 1-${MAX_PROJECT_NAME_LENGTH} 个字符。`,
      );
    }

    return name;
  }

  private projectDirectory(projectId: string): string {
    const directory = path.resolve(this.rootDirectory, projectId);
    const rootPrefix = this.rootDirectory.endsWith(path.sep)
      ? this.rootDirectory
      : `${this.rootDirectory}${path.sep}`;

    if (directory !== this.rootDirectory && !directory.startsWith(rootPrefix)) {
      throw new IpcError('PROJECT_INVALID_ARGUMENT', '项目 ID 无效。');
    }

    return directory;
  }
}
