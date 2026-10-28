import { describe, expect, it } from 'vitest';
import type { VideoProject } from '@miaoma/video-project';
import {
  canRedoSession,
  canUndoSession,
  createEditorSession,
  editorSessionReducer,
  isEditorReadOnly,
  type EditorSessionAction,
  type EditorSessionState,
} from './editor-session';
import { createEditingProject } from './test-support/editing-project';

function reorder(sceneId: string, targetIndex: number): EditorSessionAction {
  return { action: { sceneId, targetIndex, type: 'reorder-scene' }, type: 'edit' };
}

function reduce(state: EditorSessionState, ...actions: EditorSessionAction[]): EditorSessionState {
  return actions.reduce(editorSessionReducer, state);
}

function sceneOrder(project: VideoProject): string[] {
  return project.scenes.map((scene) => `${scene.id}:${scene.index}`);
}

function withRevision(project: VideoProject, contentRevision: number): VideoProject {
  return {
    ...project,
    project: { ...project.project, contentRevision },
  };
}

describe('createEditorSession', () => {
  it('loads the project document without pending edits', () => {
    const project = createEditingProject();
    const session = createEditorSession(project);

    expect(session.project).toBe(project);
    expect(session.contentRevision).toBe(2);
    expect(session.dirty).toBe(false);
    expect(session.saveStatus).toBe('idle');
    expect(session.readonly).toBe(false);
    expect(canUndoSession(session)).toBe(false);
    expect(canRedoSession(session)).toBe(false);
  });
});

describe('editor session editing', () => {
  it('applies a scene reorder and marks the document dirty', () => {
    const session = reduce(createEditorSession(createEditingProject()), reorder('scene-3', 0));

    expect(sceneOrder(session.project)).toEqual(['scene-3:1', 'scene-1:2', 'scene-2:3']);
    expect(session.dirty).toBe(true);
    expect(canUndoSession(session)).toBe(true);
    expect(canRedoSession(session)).toBe(false);
    expect(session.lastEditError).toBeNull();
  });

  it('keeps the document and reports why a rejected edit was not applied', () => {
    const initial = createEditorSession(createEditingProject());
    const session = reduce(initial, reorder('scene-missing', 0));

    expect(session.project).toBe(initial.project);
    expect(session.dirty).toBe(false);
    expect(session.lastEditError).toContain('分镜');
  });

  it('undoes and redoes a reorder', () => {
    const initial = createEditorSession(createEditingProject());
    const edited = reduce(initial, reorder('scene-3', 0));
    const undone = reduce(edited, { type: 'undo' });
    const redone = reduce(undone, { type: 'redo' });

    expect(sceneOrder(undone.project)).toEqual(['scene-1:1', 'scene-2:2', 'scene-3:3']);
    expect(undone.dirty).toBe(true);
    expect(canRedoSession(undone)).toBe(true);
    expect(sceneOrder(redone.project)).toEqual(['scene-3:1', 'scene-1:2', 'scene-2:3']);
  });

  it('keeps at least 20 undo steps for repeated reorders', () => {
    let session = createEditorSession(createEditingProject());

    // 每步把当前第一个分镜移到末尾：三拍循环，保证每次都是真实变更。
    for (let step = 0; step < 21; step += 1) {
      const first = session.project.scenes.find((scene) => scene.index === 1);

      expect(first).toBeDefined();
      session = reduce(session, reorder(first?.id ?? '', 2));
    }

    const edited = sceneOrder(session.project);

    for (let step = 0; step < 20; step += 1) {
      expect(canUndoSession(session)).toBe(true);
      session = reduce(session, { type: 'undo' });
    }

    expect(session.project.scenes).toHaveLength(3);
    expect(sceneOrder(session.project)).not.toEqual(edited);
    expect(canUndoSession(session)).toBe(true);

    for (let step = 0; step < 20; step += 1) {
      session = reduce(session, { type: 'redo' });
    }

    expect(sceneOrder(session.project)).toEqual(edited);
  });

  it('ignores edits and undo while the workflow makes the editor read only', () => {
    const initial = createEditorSession(createEditingProject(), { readonly: true });
    const edited = reduce(initial, reorder('scene-3', 0));
    const undone = reduce(edited, { type: 'undo' });

    expect(edited).toBe(initial);
    expect(undone).toBe(initial);
    expect(initial.saveStatus).toBe('idle');
  });

  it('tracks read only changes from the workflow status', () => {
    const initial = createEditorSession(createEditingProject());
    const locked = reduce(initial, { readonly: true, type: 'readonly-changed' });
    const unlocked = reduce(locked, { readonly: false, type: 'readonly-changed' });

    expect(locked.readonly).toBe(true);
    expect(unlocked.readonly).toBe(false);
  });
});

describe('editor session saving', () => {
  it('marks the document as saved and adopts the incremented revision', () => {
    const project = createEditingProject();
    const initial = createEditorSession(project);
    const edited = reduce(initial, reorder('scene-3', 0));
    const saving = reduce(edited, { type: 'save-start' });
    const saved = reduce(saving, {
      project: withRevision(edited.project, 3),
      savedSeq: edited.editSeq,
      type: 'save-success',
    });

    expect(saving.saveStatus).toBe('saving');
    expect(saved.saveStatus).toBe('saved');
    expect(saved.dirty).toBe(false);
    expect(saved.contentRevision).toBe(3);
    expect(saved.project.scenes.map((scene) => scene.id)).toEqual(
      edited.project.scenes.map((scene) => scene.id),
    );
    expect(canUndoSession(saved)).toBe(true);
  });

  it('keeps the document dirty when an edit lands while the save is in flight', () => {
    const initial = createEditorSession(createEditingProject());
    const edited = reduce(initial, reorder('scene-3', 0));
    const encodedSeq = edited.editSeq;
    const saving = reduce(edited, { type: 'save-start' });
    const editedAgain = reduce(saving, reorder('scene-1', 2));
    const saved = reduce(editedAgain, {
      project: withRevision(edited.project, 3),
      savedSeq: encodedSeq,
      type: 'save-success',
    });

    expect(saved.contentRevision).toBe(3);
    expect(saved.dirty).toBe(true);
    expect(saved.saveStatus).toBe('idle');
    expect(sceneOrder(saved.project)).toEqual(sceneOrder(editedAgain.project));
  });

  it('enters the conflict state without discarding local edits', () => {
    const edited = reduce(createEditorSession(createEditingProject()), reorder('scene-3', 0));
    const saved = reduce(edited, { type: 'save-start' });
    const conflict = reduce(saved, { type: 'save-conflict' });
    const blocked = reduce(conflict, reorder('scene-1', 2));

    expect(conflict.saveStatus).toBe('conflict');
    expect(conflict.dirty).toBe(true);
    expect(conflict.project).toBe(edited.project);
    expect(blocked).toBe(conflict);
  });

  it('keeps local edits and exposes the message when a save fails', () => {
    const edited = reduce(createEditorSession(createEditingProject()), reorder('scene-3', 0));
    const saving = reduce(edited, { type: 'save-start' });
    const failed = reduce(saving, { message: '磁盘已满。', type: 'save-error' });

    expect(failed.saveStatus).toBe('error');
    expect(failed.lastSaveError).toBe('磁盘已满。');
    expect(failed.dirty).toBe(true);
    expect(failed.project).toBe(edited.project);
  });

  it('reloads the latest project and clears the conflict state', () => {
    const edited = reduce(createEditorSession(createEditingProject()), reorder('scene-3', 0));
    const conflict = reduce(edited, { type: 'save-conflict' });
    const reloadedProject = withRevision(createEditingProject(), 5);
    const reloaded = reduce(conflict, { project: reloadedProject, type: 'reload' });

    expect(reloaded.project).toBe(reloadedProject);
    expect(reloaded.contentRevision).toBe(5);
    expect(reloaded.dirty).toBe(false);
    expect(reloaded.saveStatus).toBe('idle');
    expect(canUndoSession(reloaded)).toBe(false);
    expect(reduce(reloaded, reorder('scene-2', 0)).dirty).toBe(true);
  });
});

describe('isEditorReadOnly', () => {
  it('locks the editor while a workflow is running or waiting for approval', () => {
    expect(isEditorReadOnly('running')).toBe(true);
    expect(isEditorReadOnly('waiting_user')).toBe(true);
  });

  it('keeps the editor editable for every other workflow state', () => {
    expect(isEditorReadOnly('pending')).toBe(false);
    expect(isEditorReadOnly('succeeded')).toBe(false);
    expect(isEditorReadOnly('failed')).toBe(false);
    expect(isEditorReadOnly('cancelled')).toBe(false);
    expect(isEditorReadOnly(null)).toBe(false);
  });
});
