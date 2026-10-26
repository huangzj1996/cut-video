import { describe, expect, it } from 'vitest';
import { createChatHash, editorHash, parseEditorRoute, projectOpenHash } from './routes';

describe('parseEditorRoute', () => {
  it('parses a project-scoped editor route', () => {
    expect(parseEditorRoute('#/editor/project-1')).toEqual({
      kind: 'editor',
      projectId: 'project-1',
    });
    expect(parseEditorRoute('#/editor/Abc_123-x')).toEqual({
      kind: 'editor',
      projectId: 'Abc_123-x',
    });
  });

  it('rejects a bare editor route without a project id', () => {
    expect(parseEditorRoute('#/editor')).toEqual({ kind: 'invalid' });
    expect(parseEditorRoute('#/editor/')).toEqual({ kind: 'invalid' });
  });

  it('rejects ids that could escape the project directory', () => {
    for (const hash of [
      '#/editor/../other-project',
      '#/editor/project/extra',
      '#/editor/project%2Fextra',
      '#/editor/a b',
      '#/editor/a.b',
      `#/editor/${'a'.repeat(129)}`,
    ]) {
      expect(parseEditorRoute(hash)).toEqual({ kind: 'invalid' });
    }
  });

  it('leaves non-editor routes to the rest of the app', () => {
    for (const hash of ['', '#/workspace', '#/create', '#/editorial', '#/create-chat/project-1']) {
      expect(parseEditorRoute(hash)).toEqual({ kind: 'other' });
    }
  });
});

describe('hash builders', () => {
  it('builds the same routes the app parses', () => {
    expect(editorHash('project-1')).toBe('#/editor/project-1');
    expect(createChatHash('project-1')).toBe('#/create-chat/project-1');
  });
});

describe('projectOpenHash', () => {
  it('sends completed projects to their project-scoped editor', () => {
    expect(projectOpenHash('project-1', false)).toBe('#/editor/project-1');
  });

  it('sends drafts back to the creation conversation', () => {
    expect(projectOpenHash('project-1', true)).toBe('#/create-chat/project-1');
  });
});
