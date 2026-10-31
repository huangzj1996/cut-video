import { describe, expect, it } from 'vitest';
import {
  EXPORT_ENTRY_COPY,
  EXPORT_LOCK_BANNER,
  EXPORT_LOCK_SAVE_DENIED,
  resolveEditorLock,
} from './export-lock';

const WORKFLOW_BANNER = 'AI 工作流正在运行，编辑器暂时只读；完成后即可继续编辑。';

describe('resolveEditorLock', () => {
  it('leaves the editor fully usable when nothing is in flight', () => {
    const lock = resolveEditorLock({ exportLocked: false, readonly: false, readonlyMessage: null });

    expect(lock).toEqual({ banner: null, editingLocked: false, navigationLocked: false });
  });

  it('locks editing but not navigation while the workflow holds the project readonly', () => {
    const lock = resolveEditorLock({
      exportLocked: false,
      readonly: true,
      readonlyMessage: WORKFLOW_BANNER,
    });

    expect(lock.editingLocked).toBe(true);
    expect(lock.navigationLocked).toBe(false);
    expect(lock.banner).toBe(WORKFLOW_BANNER);
  });

  it('locks editing and navigation while an export runs', () => {
    const lock = resolveEditorLock({ exportLocked: true, readonly: false, readonlyMessage: null });

    expect(lock.editingLocked).toBe(true);
    expect(lock.navigationLocked).toBe(true);
    expect(lock.banner).toBe(EXPORT_LOCK_BANNER);
  });

  it('keeps export navigation copy free of placeholders', () => {
    const strings = [
      ...Object.values(EXPORT_ENTRY_COPY),
      EXPORT_LOCK_BANNER,
      EXPORT_LOCK_SAVE_DENIED,
    ];

    for (const text of strings) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/占位|待接入|TODO|FIXME/);
    }
  });

  it('prefers the export lock banner when both locks are active', () => {
    const lock = resolveEditorLock({
      exportLocked: true,
      readonly: true,
      readonlyMessage: WORKFLOW_BANNER,
    });

    expect(lock.banner).toBe(EXPORT_LOCK_BANNER);
    expect(lock.navigationLocked).toBe(true);
  });
});
