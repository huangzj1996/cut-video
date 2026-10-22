import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_SETTINGS,
  PROJECT_SCHEMA_VERSION,
  ProjectHeaderSchema,
  ProjectSettingsSchema,
} from './index';

const validHeader = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  projectId: 'project-1',
  contentRevision: 0,
  name: '测试工程',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

describe('project schemas', () => {
  it('accepts a valid project header', () => {
    expect(ProjectHeaderSchema.parse(validHeader)).toEqual(validHeader);
  });

  it('rejects a negative content revision', () => {
    expect(() => ProjectHeaderSchema.parse({ ...validHeader, contentRevision: -1 })).toThrow();
  });

  it('rejects an unknown schema version', () => {
    expect(() => ProjectHeaderSchema.parse({ ...validHeader, schemaVersion: 2 })).toThrow();
  });

  it('locks v1 settings to 16:9 1080p 30fps with muted source audio', () => {
    expect(ProjectSettingsSchema.parse(DEFAULT_PROJECT_SETTINGS)).toEqual(DEFAULT_PROJECT_SETTINGS);
    expect(() =>
      ProjectSettingsSchema.parse({ ...DEFAULT_PROJECT_SETTINGS, aspectRatio: '9:16' }),
    ).toThrow();
    expect(() => ProjectSettingsSchema.parse({ ...DEFAULT_PROJECT_SETTINGS, fps: 60 })).toThrow();
  });
});
