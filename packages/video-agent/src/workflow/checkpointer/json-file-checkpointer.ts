import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  getCheckpointId,
  writesSortKey,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import { WorkflowError } from '../errors';
import { pathExists, readJsonFile, writeJsonAtomic } from '../fs-utils';

export const CHECKPOINT_SCHEMA_VERSION = '1.0.0' as const;

interface SerializedValue {
  type: string;
  data: string;
}

interface StoredCheckpoint {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  checkpoint: SerializedValue;
  metadata: SerializedValue;
  parentCheckpointId?: string;
}

interface StoredWrite {
  taskId: string;
  idx: number;
  channel: string;
  taskPath: string;
  value: SerializedValue;
}

interface StoredWrites {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  writes: StoredWrite[];
}

interface CheckpointIndex {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  checkpointIds: string[];
  latest?: string;
}

const CHECKPOINT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function encodeFileId(value: string): string {
  if (!CHECKPOINT_ID_PATTERN.test(value)) {
    throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', 'checkpoint id 非法。');
  }

  return encodeURIComponent(value);
}

function assertEnvelope(value: unknown): asserts value is StoredCheckpoint {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { schemaVersion?: unknown }).schemaVersion !== CHECKPOINT_SCHEMA_VERSION
  ) {
    throw new WorkflowError('WORKFLOW_CHECKPOINT_INCOMPATIBLE', '检查点版本与当前应用不兼容。');
  }
}

/**
 * LangGraph 的 JSON 文件 checkpointer。
 *
 * 一个实例绑定一个 run 的 `<project>/analysis/runs/<runId>/checkpoints/`；
 * `thread_id` 只存在 envelope/config 中，绝不参与目录名。
 *
 * 行为参照 `MemorySaver`：
 * - 每次 `put` 写一个 checkpoint 文件并原子更新 index；
 * - `putWrites` 以 `${taskId},${idx}` 合并，正索引已存在则跳过，负索引覆盖；
 * - `getTuple` 返回按 `writesSortKey` 排序的 pendingWrites。
 */
export class JsonFileCheckpointer extends BaseCheckpointSaver {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      directory: string;
      threadId: string;
    },
  ) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { namespace, checkpointId } = this.readConfig(config);
    const directory = this.namespaceDirectory(namespace);
    const resolvedId = checkpointId ?? (await this.readLatestId(directory));

    if (!resolvedId) {
      return undefined;
    }

    const stored = await this.readCheckpoint(directory, resolvedId);

    if (!stored) {
      return undefined;
    }

    const checkpoint = (await this.deserialize(stored.checkpoint)) as Checkpoint;
    const metadata = (await this.deserialize(stored.metadata)) as CheckpointMetadata;
    const pendingWrites = await this.readPendingWrites(directory, resolvedId);

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: this.options.threadId,
          checkpoint_ns: namespace,
          checkpoint_id: resolvedId,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };

    if (stored.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: {
          thread_id: this.options.threadId,
          checkpoint_ns: namespace,
          checkpoint_id: stored.parentCheckpointId,
        },
      };
    }

    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const requestedThread = config.configurable?.thread_id;

    if (requestedThread !== undefined && requestedThread !== this.options.threadId) {
      return;
    }

    const configuredNamespace = config.configurable?.checkpoint_ns;
    const namespaces =
      typeof configuredNamespace === 'string' ? [configuredNamespace] : await this.listNamespaces();

    const beforeId = options?.before?.configurable?.checkpoint_id;
    const beforeCheckpointId =
      typeof beforeId === 'string' && beforeId !== '' ? beforeId : undefined;
    let remaining = options?.limit ?? Number.POSITIVE_INFINITY;

    for (const namespace of namespaces) {
      const directory = this.namespaceDirectory(namespace);
      const ids = await this.readCheckpointIds(directory);

      for (const id of ids.slice().reverse()) {
        if (remaining <= 0) {
          return;
        }

        if (beforeCheckpointId !== undefined && id >= beforeCheckpointId) {
          continue;
        }

        const tuple = await this.getTuple({
          configurable: {
            thread_id: this.options.threadId,
            checkpoint_ns: namespace,
            checkpoint_id: id,
          },
        });

        if (!tuple) {
          continue;
        }

        if (
          options?.filter &&
          !Object.entries(options.filter).every(
            ([key, value]) => (tuple.metadata as Record<string, unknown>)[key] === value,
          )
        ) {
          continue;
        }

        remaining -= 1;
        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    if (typeof checkpoint.id !== 'string' || checkpoint.id.length === 0) {
      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', 'checkpoint 缺少 id。');
    }

    const { namespace } = this.readConfig(config);
    const parentCheckpointId = getCheckpointId(config) || undefined;
    const directory = this.namespaceDirectory(namespace);
    const stored: StoredCheckpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      checkpoint: await this.serialize(checkpoint),
      metadata: await this.serialize(metadata),
      ...(parentCheckpointId !== undefined ? { parentCheckpointId } : {}),
    };

    await this.withLock(async () => {
      await fs.mkdir(directory, { recursive: true });
      await writeJsonAtomic(this.checkpointPath(directory, checkpoint.id), stored);
      const index = await this.readIndex(directory);

      if (!index.checkpointIds.includes(checkpoint.id)) {
        index.checkpointIds.push(checkpoint.id);
      }

      index.latest = checkpoint.id;
      await writeJsonAtomic(this.indexPath(directory), index);
    });

    return {
      configurable: {
        thread_id: this.options.threadId,
        checkpoint_ns: namespace,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath?: string,
  ): Promise<void> {
    const { namespace, checkpointId } = this.readConfig(config);

    if (!checkpointId) {
      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', 'putWrites 需要 checkpoint_id。');
    }

    const directory = this.namespaceDirectory(namespace);

    await this.withLock(async () => {
      const stored = await this.readWrites(directory, checkpointId);
      const byKey = new Map(stored.writes.map((write) => [`${write.taskId},${write.idx}`, write]));

      for (const [position, [channel, value]] of writes.entries()) {
        const idx = WRITES_IDX_MAP[channel] ?? position;
        const key = `${taskId},${idx}`;

        if (idx >= 0 && byKey.has(key)) {
          continue;
        }

        byKey.set(key, {
          taskId,
          idx,
          channel,
          taskPath: taskPath ?? '',
          value: await this.serialize(value),
        });
      }

      const next: StoredWrites = {
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        writes: [...byKey.values()],
      };

      await writeJsonAtomic(this.writesPath(directory, checkpointId), next);
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    if (threadId !== this.options.threadId) {
      return;
    }

    await this.withLock(async () => {
      await fs.rm(this.options.directory, { recursive: true, force: true });
    });
  }

  private readConfig(config: RunnableConfig): {
    namespace: string;
    checkpointId?: string;
  } {
    const threadId = config.configurable?.thread_id;

    if (threadId !== this.options.threadId) {
      throw new WorkflowError(
        'WORKFLOW_CHECKPOINT_INVALID',
        'checkpoint thread_id 与 run 不匹配。',
      );
    }

    const rawNamespace = config.configurable?.checkpoint_ns ?? '';

    if (typeof rawNamespace !== 'string') {
      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', 'checkpoint namespace 非法。');
    }

    const rawCheckpointId = getCheckpointId(config);

    if (typeof rawCheckpointId !== 'string') {
      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', 'checkpoint id 非法。');
    }

    const checkpointId = rawCheckpointId === '' ? undefined : rawCheckpointId;

    return {
      namespace: rawNamespace,
      ...(checkpointId !== undefined ? { checkpointId } : {}),
    };
  }

  private namespaceDirectory(namespace: string): string {
    const name = namespace === '' ? '_root' : encodeURIComponent(namespace);
    return path.join(this.options.directory, name);
  }

  private checkpointPath(directory: string, checkpointId: string): string {
    return path.join(directory, `${encodeFileId(checkpointId)}.json`);
  }

  private writesPath(directory: string, checkpointId: string): string {
    return path.join(directory, `${encodeFileId(checkpointId)}.writes.json`);
  }

  private indexPath(directory: string): string {
    return path.join(directory, 'index.json');
  }

  private async readCheckpoint(
    directory: string,
    checkpointId: string,
  ): Promise<StoredCheckpoint | undefined> {
    const filePath = this.checkpointPath(directory, checkpointId);

    if (!(await pathExists(filePath))) {
      return undefined;
    }

    try {
      const raw = await readJsonFile<unknown>(filePath);
      assertEnvelope(raw);
      return raw;
    } catch (error) {
      if (error instanceof WorkflowError) {
        throw error;
      }

      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', '检查点文件损坏。');
    }
  }

  private async readPendingWrites(
    directory: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const stored = await this.readWrites(directory, checkpointId);
    const ordered = stored.writes
      .slice()
      .sort((left, right) =>
        compareWritesSortKeys(
          writesSortKey(left.taskPath, left.taskId, left.idx),
          writesSortKey(right.taskPath, right.taskId, right.idx),
        ),
      );

    return Promise.all(
      ordered.map(
        async (write) =>
          [
            write.taskId,
            write.channel,
            await this.deserialize(write.value),
          ] as CheckpointPendingWrite,
      ),
    );
  }

  private async readWrites(directory: string, checkpointId: string): Promise<StoredWrites> {
    const filePath = this.writesPath(directory, checkpointId);

    if (!(await pathExists(filePath))) {
      return { schemaVersion: CHECKPOINT_SCHEMA_VERSION, writes: [] };
    }

    try {
      const raw = await readJsonFile<unknown>(filePath);

      if (
        typeof raw !== 'object' ||
        raw === null ||
        (raw as { schemaVersion?: unknown }).schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
        !Array.isArray((raw as { writes?: unknown }).writes)
      ) {
        throw new WorkflowError('WORKFLOW_CHECKPOINT_INCOMPATIBLE', '检查点写入记录不兼容。');
      }

      return raw as StoredWrites;
    } catch (error) {
      if (error instanceof WorkflowError) {
        throw error;
      }

      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', '检查点写入记录损坏。');
    }
  }

  private async readIndex(directory: string): Promise<CheckpointIndex> {
    const filePath = this.indexPath(directory);

    if (!(await pathExists(filePath))) {
      const ids = await this.scanCheckpointIds(directory);
      return {
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        checkpointIds: ids,
        ...(ids.length > 0 ? { latest: ids[ids.length - 1] } : {}),
      };
    }

    try {
      const raw = await readJsonFile<unknown>(filePath);

      if (
        typeof raw !== 'object' ||
        raw === null ||
        (raw as { schemaVersion?: unknown }).schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
        !Array.isArray((raw as { checkpointIds?: unknown }).checkpointIds)
      ) {
        throw new WorkflowError('WORKFLOW_CHECKPOINT_INCOMPATIBLE', '检查点索引不兼容。');
      }

      return raw as CheckpointIndex;
    } catch (error) {
      if (error instanceof WorkflowError) {
        throw error;
      }

      throw new WorkflowError('WORKFLOW_CHECKPOINT_INVALID', '检查点索引损坏。');
    }
  }

  private async readLatestId(directory: string): Promise<string | undefined> {
    const index = await this.readIndex(directory);

    if (index.latest) {
      return index.latest;
    }

    const ids = index.checkpointIds;
    return ids[ids.length - 1];
  }

  private async readCheckpointIds(directory: string): Promise<string[]> {
    const index = await this.readIndex(directory);
    return index.checkpointIds;
  }

  private async scanCheckpointIds(directory: string): Promise<string[]> {
    let entries: string[];

    try {
      entries = await fs.readdir(directory);
    } catch {
      return [];
    }

    return entries
      .filter(
        (entry) =>
          entry.endsWith('.json') && !entry.endsWith('.writes.json') && entry !== 'index.json',
      )
      .map((entry) => decodeURIComponent(entry.slice(0, -'.json'.length)))
      .sort();
  }

  private async listNamespaces(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.options.directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => (entry.name === '_root' ? '' : decodeURIComponent(entry.name)));
    } catch {
      return [];
    }
  }

  private async serialize(value: unknown): Promise<SerializedValue> {
    const [type, data] = await this.serde.dumpsTyped(value);
    return { type, data: Buffer.from(data).toString('base64') };
  }

  private async deserialize(value: SerializedValue): Promise<unknown> {
    return this.serde.loadsTyped(value.type, Buffer.from(value.data, 'base64'));
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
