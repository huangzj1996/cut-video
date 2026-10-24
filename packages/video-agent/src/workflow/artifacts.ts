import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ArtifactRefPathSchema,
  ArtifactReferenceSchema,
  type ArtifactKind,
  type ArtifactReference,
} from '@miaoma/video-project';
import { WorkflowError } from './errors';
import { computeFingerprint } from './fingerprint';
import {
  pathExists,
  readJsonFile,
  resolveInside,
  writeFileAtomic,
  writeJsonAtomic,
} from './fs-utils';
import type { ArtifactStore, ArtifactWriteOptions, ArtifactWriteResult } from './types';

export const ARTIFACT_INDEX_SCHEMA_VERSION = '1.0.0' as const;
export const ARTIFACT_INDEX_FILE = 'analysis/artifacts-index.json';

const ArtifactIndexSchema = z.strictObject({
  schemaVersion: z.literal(ARTIFACT_INDEX_SCHEMA_VERSION),
  entries: z.record(z.string(), ArtifactReferenceSchema),
});

type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;

function cacheKeyFor(kind: ArtifactKind, cacheKey: string): string {
  return `${kind}:${cacheKey}`;
}

function zodDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/**
 * 工程目录内的 JSON 产物存储。
 *
 * - 每个产物写为同目录临时文件 + rename；
 * - `analysis/artifacts-index.json` 以 `kind:inputFingerprint` 做内容寻址，
 *   让 interrupt 重跑节点时复用已有产物；
 * - 路径永远是工程内相对 POSIX 路径，读写都做 containment 校验。
 */
export class FileArtifactStore implements ArtifactStore {
  readonly projectDirectory: string;
  private index: ArtifactIndex | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    projectDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.projectDirectory = path.resolve(projectDirectory);
  }

  resolve(relativePath: string): string {
    const parsed = ArtifactRefPathSchema.safeParse(relativePath);

    if (!parsed.success) {
      throw new WorkflowError(
        'WORKFLOW_ARTIFACT_INVALID',
        `产物路径无效：${relativePath}`,
        false,
        zodDetails(parsed.error),
      );
    }

    return resolveInside(this.projectDirectory, parsed.data);
  }

  async write<T>(options: ArtifactWriteOptions<T>): Promise<ArtifactWriteResult> {
    const data = options.schema.parse(options.data);
    const cacheKey =
      options.cacheKey !== undefined ? cacheKeyFor(options.kind, options.cacheKey) : undefined;

    return this.withLock(async () => {
      const index = await this.loadIndex();

      if (cacheKey) {
        const existing = index.entries[cacheKey];

        if (existing && (await pathExists(this.resolve(existing.ref)))) {
          return { reference: existing, created: false };
        }
      }

      const filePath = this.resolve(options.fileName);
      const contentFingerprint = computeFingerprint(data);
      await writeJsonAtomic(filePath, data);

      const reference: ArtifactReference = ArtifactReferenceSchema.parse({
        kind: options.kind,
        ref: options.fileName,
        version: options.version,
        contentFingerprint,
        createdAt: this.now().toISOString(),
      });

      if (cacheKey) {
        index.entries[cacheKey] = reference;
        await this.saveIndex(index);
      }

      return { reference, created: true };
    });
  }

  async read<T>(reference: ArtifactReference, schema: z.ZodType<T>): Promise<T> {
    const filePath = this.resolve(reference.ref);

    let raw: unknown;

    try {
      raw = await readJsonFile<unknown>(filePath);
    } catch {
      throw new WorkflowError(
        'WORKFLOW_ARTIFACT_INVALID',
        `产物不存在或无法读取：${reference.ref}`,
        false,
      );
    }

    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      throw new WorkflowError(
        'WORKFLOW_ARTIFACT_INVALID',
        `产物结构无效：${reference.ref}`,
        false,
        zodDetails(parsed.error),
      );
    }

    return parsed.data;
  }

  async findReusable(kind: ArtifactKind, cacheKey: string): Promise<ArtifactReference | null> {
    return this.withLock(async () => {
      const index = await this.loadIndex();
      const key = cacheKeyFor(kind, cacheKey);
      const entry = index.entries[key];

      if (!entry) {
        return null;
      }

      if (await pathExists(this.resolve(entry.ref))) {
        return entry;
      }

      delete index.entries[key];
      await this.saveIndex(index);
      return null;
    });
  }

  async findLatest(kind: ArtifactKind): Promise<ArtifactReference | null> {
    return this.withLock(async () => {
      const index = await this.loadIndex();
      let latest: ArtifactReference | null = null;

      for (const entry of Object.values(index.entries)) {
        if (entry.kind !== kind) {
          continue;
        }

        if (!latest || entry.version > latest.version) {
          latest = entry;
        }
      }

      if (latest && (await pathExists(this.resolve(latest.ref)))) {
        return latest;
      }

      return null;
    });
  }

  async writeFile(relativePath: string, data: string | Uint8Array): Promise<string> {
    const filePath = this.resolve(relativePath);
    await writeFileAtomic(filePath, data);
    return filePath;
  }

  private async loadIndex(): Promise<ArtifactIndex> {
    if (this.index) {
      return this.index;
    }

    const indexPath = this.resolve(ARTIFACT_INDEX_FILE);

    if (!(await pathExists(indexPath))) {
      this.index = { schemaVersion: ARTIFACT_INDEX_SCHEMA_VERSION, entries: {} };
      return this.index;
    }

    try {
      const raw = await readJsonFile<unknown>(indexPath);
      const parsed = ArtifactIndexSchema.safeParse(raw);

      if (!parsed.success) {
        throw parsed.error;
      }

      this.index = parsed.data;
      return this.index;
    } catch (error) {
      throw new WorkflowError(
        'WORKFLOW_ARTIFACT_INVALID',
        '产物索引损坏。',
        false,
        error instanceof z.ZodError ? zodDetails(error) : undefined,
      );
    }
  }

  private async saveIndex(index: ArtifactIndex): Promise<void> {
    await writeJsonAtomic(this.resolve(ARTIFACT_INDEX_FILE), index);
    this.index = index;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** 测试和只读节点使用的空存储；写入直接抛错。 */
export class NullArtifactStore implements ArtifactStore {
  constructor(readonly projectDirectory: string) {}

  resolve(relativePath: string): string {
    return path.resolve(this.projectDirectory, relativePath);
  }

  async write<T>(_options: ArtifactWriteOptions<T>): Promise<ArtifactWriteResult> {
    throw new WorkflowError('WORKFLOW_ARTIFACT_INVALID', 'artifact store is read-only');
  }

  async read<T>(_reference: ArtifactReference, _schema: z.ZodType<T>): Promise<T> {
    throw new WorkflowError('WORKFLOW_ARTIFACT_INVALID', 'artifact store is read-only');
  }

  async findReusable(): Promise<ArtifactReference | null> {
    return null;
  }

  async findLatest(): Promise<ArtifactReference | null> {
    return null;
  }

  async writeFile(): Promise<string> {
    throw new WorkflowError('WORKFLOW_ARTIFACT_INVALID', 'artifact store is read-only');
  }
}

export async function ensureProjectDirectory(projectDirectory: string): Promise<void> {
  await fs.mkdir(path.resolve(projectDirectory), { recursive: true });
}
