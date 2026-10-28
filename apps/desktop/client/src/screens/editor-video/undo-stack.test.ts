import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  HISTORY_LIMIT,
  redoHistory,
  undoHistory,
} from './undo-stack';

describe('undo stack', () => {
  it('starts with the loaded document and nothing to undo or redo', () => {
    const history = createHistory('v0');

    expect(history.present).toBe('v0');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('commits a new document and can undo back to the previous one', () => {
    const afterEdit = commitHistory(createHistory('v0'), 'v1');

    expect(afterEdit.present).toBe('v1');
    expect(canUndo(afterEdit)).toBe(true);

    const undone = undoHistory(afterEdit);

    expect(undone.present).toBe('v0');
    expect(canRedo(undone)).toBe(true);
  });

  it('redoes the document that was undone', () => {
    const undone = undoHistory(commitHistory(createHistory('v0'), 'v1'));

    expect(redoHistory(undone).present).toBe('v1');
  });

  it('clears the redo branch when a new edit is committed after undoing', () => {
    const undone = undoHistory(commitHistory(createHistory('v0'), 'v1'));
    const committed = commitHistory(undone, 'v2');

    expect(canRedo(committed)).toBe(false);
    expect(redoHistory(committed).present).toBe('v2');
  });

  it('keeps at least 20 steps and supports exactly 50 stored snapshots', () => {
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(20);

    let history = createHistory(0);

    for (let value = 1; value <= 21; value += 1) {
      history = commitHistory(history, value);
    }

    for (let step = 0; step < 20; step += 1) {
      history = undoHistory(history);
    }

    expect(history.present).toBe(1);
  });

  it('drops the oldest snapshots beyond the 50-step limit', () => {
    let history = createHistory(0);

    for (let value = 1; value <= HISTORY_LIMIT + 10; value += 1) {
      history = commitHistory(history, value);
    }

    for (let step = 0; step < HISTORY_LIMIT; step += 1) {
      expect(canUndo(history)).toBe(true);
      history = undoHistory(history);
    }

    expect(canUndo(history)).toBe(false);
    expect(history.present).toBe(10);
  });

  it('is a no-op at the ends of the stack', () => {
    const initial = createHistory('v0');

    expect(undoHistory(initial)).toBe(initial);
    expect(redoHistory(initial)).toBe(initial);
  });
});
