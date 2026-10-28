/**
 * 编辑器撤销/重做栈。
 *
 * 按需求实现 50 步（验收要求至少 20 步）。每次成功编辑把上一份文档压入
 * `past`，撤销时把当前文档放进 `future`；新编辑会丢弃 redo 分支。
 * 快照只存在渲染进程内存里，不持久化。
 */

export const HISTORY_LIMIT = 50;

export interface History<T> {
  future: T[];
  past: T[];
  present: T;
}

export function createHistory<T>(present: T): History<T> {
  return { future: [], past: [], present };
}

function capPast<T>(past: readonly T[]): T[] {
  return past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past.slice();
}

/** 提交一份新文档：保留旧文档用于撤销，并清空 redo 分支。 */
export function commitHistory<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) {
    return history;
  }

  return {
    future: [],
    past: capPast([...history.past, history.present]),
    present: next,
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];

  if (previous === undefined) {
    return history;
  }

  return {
    future: [history.present, ...history.future],
    past: history.past.slice(0, -1),
    present: previous,
  };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;

  if (next === undefined) {
    return history;
  }

  return {
    future: rest,
    past: capPast([...history.past, history.present]),
    present: next,
  };
}
