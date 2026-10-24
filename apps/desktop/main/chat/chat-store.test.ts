import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage } from '@miaoma/video-project';
import { ProjectStore } from '../projects/project-store';
import { ChatStore } from './chat-store';

const NOW = '2026-10-24T00:00:00.000Z';

function expectErrorCode(callback: () => unknown, code: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`expected error code ${code}`);
}

describe('ChatStore', () => {
  let root: string;
  let projectStore: ProjectStore;
  let store: ChatStore;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'miaoma-chat-store-'));
    projectStore = new ProjectStore(root);
    store = new ChatStore(() => projectStore);
    projectId = projectStore.create({ name: '测试项目' }).project.projectId;
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  function message(id = 'message-1'): ChatMessage {
    return ChatMessageSchema.parse({
      id,
      projectId,
      role: 'user',
      type: 'user_requirement',
      payload: {
        kind: 'initial_request',
        script: '一段口播文稿。',
        voicePresetId: 'wenrou-xuejie',
        tags: [],
      },
      revision: 0,
      status: 'completed',
      createdAt: NOW,
    });
  }

  it('returns an empty log when messages.json is missing', () => {
    expect(store.read(projectId)).toEqual([]);
  });

  it('appends messages, dedupes by id, and reads them back', async () => {
    const appended = await store.append(projectId, [message('m1')]);

    expect(appended.map((entry) => entry.id)).toEqual(['m1']);
    expect(await store.append(projectId, [message('m1')])).toEqual([]);
    expect(store.read(projectId).map((entry) => entry.id)).toEqual(['m1']);
  });

  it('serializes concurrent appends', async () => {
    await Promise.all([
      store.append(projectId, [message('m1')]),
      store.append(projectId, [message('m2')]),
      store.append(projectId, [message('m3')]),
    ]);

    expect(store.read(projectId).map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('rejects a corrupt log instead of overwriting it', () => {
    writeFileSync(path.join(root, projectId, 'messages.json'), '{not-json', 'utf8');

    expectErrorCode(() => store.read(projectId), 'CHAT_LOG_INVALID');
  });
});
