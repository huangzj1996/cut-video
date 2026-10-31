/**
 * 导出前保存闸门：只有自动保存确实成功，才允许拿已保存修订号发起导出。
 *
 * 保存冲突不能只看 dirty：自动保存冲突时会停止后续保存，dirty 也不一定保持，
 * 所以冲突标记单独由编辑器在保存结果里同步维护。
 */
export interface ExportSaveGateInput {
  conflict: boolean;
  hasUnsavedEdits: boolean;
  savedRevision: number;
}

export type ExportSaveGateResult = { message: string; ok: false } | { ok: true; revision: number };

export function resolveExportSaveGate(input: ExportSaveGateInput): ExportSaveGateResult {
  if (input.conflict) {
    return { message: '工程已在别处修改，自动保存失败，导出已阻止。', ok: false };
  }

  if (input.hasUnsavedEdits) {
    return { message: '自动保存失败，导出已阻止。', ok: false };
  }

  return { ok: true, revision: input.savedRevision };
}
