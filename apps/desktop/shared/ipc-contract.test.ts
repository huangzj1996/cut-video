import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from './ipc-contract';

const channels = Object.values(IPC_CHANNELS).flatMap((module) => Object.values(module));

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

  it('registers the five project CRUD channels', () => {
    expect(Object.values(IPC_CHANNELS.project).sort()).toEqual([
      'project:create',
      'project:delete',
      'project:get',
      'project:list',
      'project:update',
    ]);
  });
});
