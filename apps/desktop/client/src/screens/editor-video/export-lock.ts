/**
 * 编辑器的锁定事实：工作流只读与导出进行中都会锁编辑，但提示与导航规则不同。
 *
 * - 导出进行中：锁编辑，同时禁止离开编辑器（返回创作页/切换工程）；
 *   预览播放不经过这里的任何判定，仍然可用，用户才能核对导出内容。
 * - 工作流只读：只锁编辑与保存，不拦截导航；横幅文案由 describeReadonlyBanner 提供。
 */
export const EXPORT_LOCK_BANNER = '导出进行中，编辑已锁定；预览仍可播放。';
export const EXPORT_LOCK_SAVE_DENIED = '导出进行中，编辑已锁定；完成后可继续编辑。';

/** 导出入口与导航的文案；与弹窗文案一样集中，不允许散落在组件里。 */
export const EXPORT_ENTRY_COPY = {
  entryTitle: '渲染并导出为 MP4',
  lockedTitle: '编辑器只读，暂不能导出',
  navBackTitle: '返回创作页',
  navLockedTitle: '导出进行中，完成后可返回创作页',
  openTitle: '导出面板已打开',
  runningTitle: '导出进行中',
} as const;

export interface EditorLockFacts {
  /** 顶部提示条文案；不锁定时为 null。 */
  banner: string | null;
  /** 编辑、面板参数与快捷键保存被锁定。 */
  editingLocked: boolean;
  /** 导出进行中禁止离开编辑器；工作流只读不拦截导航。 */
  navigationLocked: boolean;
}

export function resolveEditorLock(input: {
  exportLocked: boolean;
  readonly: boolean;
  readonlyMessage: string | null;
}): EditorLockFacts {
  return {
    banner: input.exportLocked ? EXPORT_LOCK_BANNER : input.readonly ? input.readonlyMessage : null,
    editingLocked: input.exportLocked || input.readonly,
    navigationLocked: input.exportLocked,
  };
}
