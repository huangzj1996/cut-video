import { describe, expect, it } from 'vitest';
import { resolveExportSaveGate } from './export-save';

describe('export save gate', () => {
  it('allows export with the last saved revision when there are no pending edits', () => {
    expect(
      resolveExportSaveGate({ conflict: false, hasUnsavedEdits: false, savedRevision: 7 }),
    ).toEqual({ ok: true, revision: 7 });
  });

  it('blocks export when autosave still has unsaved edits', () => {
    expect(
      resolveExportSaveGate({ conflict: false, hasUnsavedEdits: true, savedRevision: 7 }),
    ).toEqual({ message: '自动保存失败，导出已阻止。', ok: false });
  });

  it('blocks export when autosave hit a revision conflict', () => {
    expect(
      resolveExportSaveGate({ conflict: true, hasUnsavedEdits: false, savedRevision: 7 }),
    ).toEqual({ message: '工程已在别处修改，自动保存失败，导出已阻止。', ok: false });
  });
});
