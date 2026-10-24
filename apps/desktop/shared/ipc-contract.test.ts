import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from './ipc-contract';

const channels = Object.values(IPC_CHANNELS).flatMap((module) => Object.values(module));
const eventChannels = Object.values(IPC_EVENT_CHANNELS);

describe('IPC channel contract', () => {
  it('uses the module:action naming format', () => {
    expect(channels.length).toBeGreaterThan(0);

    for (const channel of channels) {
      expect(channel).toMatch(/^[a-z]+:[a-z][a-z-]*$/);
    }
  });

  it('keeps channel names unique', () => {
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('registers the project CRUD and asset selection channels', () => {
    expect(Object.values(IPC_CHANNELS.project).sort()).toEqual([
      'project:create',
      'project:delete',
      'project:get',
      'project:list',
      'project:select-assets',
      'project:update',
    ]);
  });

  it('registers chat and workflow invoke channels', () => {
    expect(Object.values(IPC_CHANNELS.chat).sort()).toEqual([
      'chat:list',
      'chat:retry',
      'chat:send',
      'chat:start',
    ]);
    expect(Object.values(IPC_CHANNELS.workflow).sort()).toEqual([
      'workflow:cancel',
      'workflow:get-artifact',
      'workflow:get-state',
      'workflow:resume',
    ]);
  });

  it('registers unique push event channels that do not collide with invoke channels', () => {
    expect(eventChannels.sort()).toEqual(['chat:message', 'chat:stream', 'workflow:event']);
    expect(new Set(eventChannels).size).toBe(eventChannels.length);

    for (const channel of eventChannels) {
      expect(channels).not.toContain(channel);
    }
  });
});
