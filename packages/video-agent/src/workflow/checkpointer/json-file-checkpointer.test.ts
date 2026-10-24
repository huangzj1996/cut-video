import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint';
import { createTempProject } from '../test-support/fixtures';
import { JsonFileCheckpointer } from './json-file-checkpointer';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

const THREAD_ID = 'project-1:run-1';
const NOW = '2026-10-24T00:00:00.000Z';

function metadata(step: number, source: CheckpointMetadata['source'] = 'loop'): CheckpointMetadata {
  return { source, step, parents: {} };
}

function checkpoint(id: string, value: unknown): Checkpoint {
  return {
    v: 4,
    id,
    ts: NOW,
    channel_values: { value },
    channel_versions: { value: 1 },
    versions_seen: {},
  };
}

function config(checkpointId?: string) {
  return {
    configurable: {
      thread_id: THREAD_ID,
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

describe('JsonFileCheckpointer', () => {
  let directory: string;
  let cleanup: () => Promise<void>;
  let saver: JsonFileCheckpointer;

  beforeEach(async () => {
    const temp = await createTempProject();
    directory = path.join(temp.directory, 'checkpoints');
    cleanup = temp.cleanup;
    saver = new JsonFileCheckpointer({ directory, threadId: THREAD_ID });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('puts and reads back the latest checkpoint', async () => {
    const returned = await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), {
      value: 1,
    });

    expect(returned.configurable?.checkpoint_id).toBe('cp-1');

    const tuple = await saver.getTuple(config());

    expect(tuple?.checkpoint.channel_values).toEqual({ value: 'one' });
    expect(tuple?.metadata?.source).toBe('input');
    expect(tuple?.pendingWrites).toEqual([]);
  });

  it('stores writes, skips duplicate positive indexes and sorts pending writes', async () => {
    await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), { value: 1 });

    await saver.putWrites(
      config('cp-1'),
      [
        ['a', 2],
        ['b', 3],
      ],
      'task-1',
      '',
    );
    await saver.putWrites(config('cp-1'), [['a', 99]], 'task-1', '');
    await saver.putWrites(config('cp-1'), [['__resume__', { decision: 'approve' }]], 'task-1', '');

    const tuple = await saver.getTuple(config('cp-1'));

    expect(tuple?.pendingWrites).toEqual([
      ['task-1', '__resume__', { decision: 'approve' }],
      ['task-1', 'a', 2],
      ['task-1', 'b', 3],
    ]);
  });

  it('lists checkpoints newest first with before/limit/filter', async () => {
    await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), { value: 1 });
    await saver.put(config('cp-1'), checkpoint('cp-2', 'two'), metadata(0, 'loop'), { value: 2 });
    await saver.put(config('cp-2'), checkpoint('cp-3', 'three'), metadata(1, 'loop'), { value: 3 });

    const all = await collect(saver.list(config()));
    expect(all.map((tuple) => tuple.checkpoint.id)).toEqual(['cp-3', 'cp-2', 'cp-1']);

    const before = await collect(saver.list(config(), { before: config('cp-3') }));
    expect(before.map((tuple) => tuple.checkpoint.id)).toEqual(['cp-2', 'cp-1']);

    const limited = await collect(saver.list(config(), { limit: 1 }));
    expect(limited.map((tuple) => tuple.checkpoint.id)).toEqual(['cp-3']);

    const filtered = await collect(saver.list(config(), { filter: { source: 'loop' } }));
    expect(filtered.map((tuple) => tuple.checkpoint.id)).toEqual(['cp-3', 'cp-2']);
  });

  it('recovers from a fresh instance', async () => {
    await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), { value: 1 });

    const restarted = new JsonFileCheckpointer({ directory, threadId: THREAD_ID });
    const tuple = await restarted.getTuple(config());

    expect(tuple?.checkpoint.channel_values).toEqual({ value: 'one' });
  });

  it('rejects a corrupted checkpoint file', async () => {
    await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), { value: 1 });
    const filePath = path.join(directory, '_root', `${encodeURIComponent('cp-1')}.json`);
    await fs.writeFile(filePath, '{not-json', 'utf8');

    await expect(saver.getTuple(config('cp-1'))).rejects.toMatchObject({
      code: 'WORKFLOW_CHECKPOINT_INVALID',
    });
  });

  it('rejects an incompatible checkpoint schema version', async () => {
    await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), { value: 1 });
    const filePath = path.join(directory, '_root', `${encodeURIComponent('cp-1')}.json`);
    await fs.writeFile(filePath, JSON.stringify({ schemaVersion: '2.0.0' }), 'utf8');

    await expect(saver.getTuple(config('cp-1'))).rejects.toMatchObject({
      code: 'WORKFLOW_CHECKPOINT_INCOMPATIBLE',
    });
  });

  it('deletes a thread', async () => {
    await saver.put(config(), checkpoint('cp-1', 'one'), metadata(-1, 'input'), { value: 1 });
    await saver.deleteThread(THREAD_ID);

    expect(await saver.getTuple(config())).toBeUndefined();
  });
});
