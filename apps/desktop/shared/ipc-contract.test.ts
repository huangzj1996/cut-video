import { describe, expect, it } from 'vitest';
import { EXPORT_ERROR_CODES, IPC_CHANNELS, IPC_EVENT_CHANNELS } from './ipc-contract';

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
    expect(Object.values(IPC_CHANNELS.editor).sort()).toEqual(['editor:flush-complete']);
  });

  it('registers the media channels used for waveform decoding', () => {
    expect(Object.values(IPC_CHANNELS.media).sort()).toEqual([
      'media:get-info',
      'media:read-audio',
    ]);
  });

  it('registers the music library channel', () => {
    expect(Object.values(IPC_CHANNELS.music).sort()).toEqual([
      'music:list-library',
      'music:register-asset',
    ]);
  });

  it('registers the export channels and error code namespace', () => {
    expect(Object.values(IPC_CHANNELS.export).sort()).toEqual([
      'export:cancel',
      'export:choose-target',
      'export:default-target',
      'export:reveal',
      'export:start',
    ]);
  });

  it('declares the complete EXPORT_ error-code namespace', () => {
    expect([...EXPORT_ERROR_CODES]).toEqual([
      'EXPORT_ALREADY_RUNNING',
      'EXPORT_PROJECT_READONLY_OR_DRAFT',
      'EXPORT_PROJECT_STALE',
      'EXPORT_VALIDATION_FAILED',
      'EXPORT_UNSUPPORTED_MEDIA',
      'EXPORT_UNSUPPORTED_TRANSFORM',
      'EXPORT_FONT_MISSING',
      'EXPORT_TARGET_UNWRITABLE',
      'EXPORT_RENDER_FAILED',
      'EXPORT_SYNC_CHECK_FAILED',
      'EXPORT_CANCELLED',
    ]);
    expect(new Set(EXPORT_ERROR_CODES).size).toBe(EXPORT_ERROR_CODES.length);

    for (const code of EXPORT_ERROR_CODES) {
      expect(code).toMatch(/^EXPORT_[A-Z_]+$/);
    }
  });

  it('registers unique push event channels that do not collide with invoke channels', () => {
    expect(eventChannels.sort()).toEqual([
      'chat:message',
      'chat:stream',
      'editor:flush-request',
      'export:progress',
      'export:state',
      'workflow:event',
    ]);
    expect(new Set(eventChannels).size).toBe(eventChannels.length);

    for (const channel of eventChannels) {
      expect(channels).not.toContain(channel);
    }
  });
});
