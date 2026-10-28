/**
 * 拖动视频块重排分镜的几何计算。
 *
 * 拖动中的目标是"松手后这个分镜落在第几个位置"：统计其它分镜中点在
 * 指针左侧的个数。这样右移要越过下一个分镜的中点，左移要越过前一个
 * 分镜的中点，视觉上和常见时间线编辑器一致。
 */

export interface ReorderSceneSpan {
  endSeconds: number;
  id: string;
  startSeconds: number;
}

export function reorderTargetIndex(
  scenes: readonly ReorderSceneSpan[],
  draggedSceneId: string,
  pointerSeconds: number,
): number | null {
  if (!scenes.some((scene) => scene.id === draggedSceneId)) {
    return null;
  }

  const others = scenes.filter((scene) => scene.id !== draggedSceneId);
  let target = 0;

  for (const scene of others) {
    const midpoint = (scene.startSeconds + scene.endSeconds) / 2;

    if (midpoint < pointerSeconds) {
      target += 1;
    }
  }

  return Math.min(others.length, Math.max(0, target));
}
