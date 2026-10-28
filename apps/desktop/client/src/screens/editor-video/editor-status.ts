import type { WorkflowRunStatus } from '@miaoma/video-project';
import type { SaveStatus } from './editor-session';

/**
 * 顶栏保存状态与只读横幅的展示文案。
 * 放在纯函数里，避免 UI 里再散落一层条件判断，也方便覆盖保存中/失败/冲突的区分。
 */

export type SaveStatusKind = 'conflict' | 'dirty' | 'error' | 'saved' | 'saving';

export interface SaveStatusView {
  kind: SaveStatusKind;
  label: string;
}

const SAVE_STATUS_LABELS: Record<SaveStatusKind, string> = {
  conflict: '保存冲突',
  dirty: '待保存',
  error: '保存失败',
  saved: '已保存',
  saving: '保存中',
};

/**
 * 优先级：冲突 > 保存中 > 保存失败 > 待保存 > 已保存。
 * 冲突必须压过其他状态，否则用户会以为还能覆盖别处的新修订。
 */
function saveStatusKind(saveStatus: SaveStatus, dirty: boolean): SaveStatusKind {
  switch (saveStatus) {
    case 'conflict':
      return 'conflict';
    case 'saving':
      return 'saving';
    case 'error':
      return 'error';
    default:
      return dirty ? 'dirty' : 'saved';
  }
}

export function describeSaveStatus(saveStatus: SaveStatus, dirty: boolean): SaveStatusView {
  const kind = saveStatusKind(saveStatus, dirty);

  return { kind, label: SAVE_STATUS_LABELS[kind] };
}

/** 工作流运行或等待审批时的只读原因；可编辑状态返回 null（不渲染横幅）。 */
export function describeReadonlyBanner(status: WorkflowRunStatus | null): string | null {
  switch (status) {
    case 'running':
      return 'AI 工作流正在运行，编辑器暂时只读；完成后即可继续编辑。';
    case 'waiting_user':
      return 'AI 工作流正在等待审批，编辑器暂时只读；审批完成后即可继续编辑。';
    default:
      return null;
  }
}
