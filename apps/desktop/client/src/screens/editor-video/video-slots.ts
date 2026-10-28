/**
 * 双 video 槽位的纯调度逻辑。
 *
 * 一个槽位显示当前片段，另一个预加载下一片段；切换片段时直接交换可见槽位，
 * 因此解码/加载期间仍能看到上一帧，不会长时间黑屏。主时钟仍在播放层。
 */

export type VideoSlotKey = 'a' | 'b';

export interface VideoSlotDemand {
  assetId: string;
  clipId: string;
}

export interface VideoSlot {
  assetId: string | null;
  clipId: string | null;
  error: string | null;
  ready: boolean;
}

export interface VideoSlotsState {
  active: VideoSlotKey | null;
  slots: Record<VideoSlotKey, VideoSlot>;
}

export const VIDEO_SLOT_KEYS: readonly VideoSlotKey[] = ['a', 'b'];

function emptySlot(): VideoSlot {
  return { assetId: null, clipId: null, error: null, ready: false };
}

function isEmptySlot(slot: VideoSlot): boolean {
  return slot.assetId === null && slot.clipId === null && !slot.ready && !slot.error;
}

export function createVideoSlots(): VideoSlotsState {
  return {
    active: null,
    slots: { a: emptySlot(), b: emptySlot() },
  };
}

export function otherSlot(key: VideoSlotKey): VideoSlotKey {
  return key === 'a' ? 'b' : 'a';
}

export function slotForClip(state: VideoSlotsState, clipId: string): VideoSlotKey | null {
  for (const key of VIDEO_SLOT_KEYS) {
    if (state.slots[key].clipId === clipId) {
      return key;
    }
  }

  return null;
}

function withSlot(
  state: VideoSlotsState,
  key: VideoSlotKey,
  slot: VideoSlot,
  active = state.active,
): VideoSlotsState {
  return { active, slots: { ...state.slots, [key]: slot } };
}

/**
 * 同一 asset 的相邻片段共用同一个已解码元素，只更新片段 id；换 asset 时
 * 才重置 ready/error 触发重新加载。
 */
function assign(slot: VideoSlot, demand: VideoSlotDemand | null): VideoSlot {
  if (!demand) {
    return isEmptySlot(slot) ? slot : emptySlot();
  }

  if (slot.clipId === demand.clipId && slot.assetId === demand.assetId) {
    return slot;
  }

  if (slot.assetId === demand.assetId) {
    return { ...slot, clipId: demand.clipId };
  }

  return { assetId: demand.assetId, clipId: demand.clipId, error: null, ready: false };
}

/** 已持有该片段或任一空槽位；都没有时返回 null，由调用方决定抢占哪个槽位。 */
function findAvailableSlot(state: VideoSlotsState, demand: VideoSlotDemand): VideoSlotKey | null {
  return (
    slotForClip(state, demand.clipId) ??
    VIDEO_SLOT_KEYS.find((key) => state.slots[key].clipId === null) ??
    null
  );
}

function pickIdleSlot(state: VideoSlotsState, demand: VideoSlotDemand): VideoSlotKey {
  return findAvailableSlot(state, demand) ?? (state.active ? otherSlot(state.active) : 'a');
}

function pickActiveSlot(
  state: VideoSlotsState,
  active: VideoSlotDemand,
  next: VideoSlotDemand | null,
): VideoSlotKey {
  const available = findAvailableSlot(state, active);

  if (available) {
    return available;
  }

  const busyWithNext = next ? slotForClip(state, next.clipId) : null;

  if (busyWithNext && state.active === busyWithNext) {
    return otherSlot(busyWithNext);
  }

  return state.active ? otherSlot(state.active) : 'a';
}

/**
 * 根据当前/下一片段更新两个槽位：
 * - 当前槽位未 ready 时不动另一槽位，保留上一帧作为过渡画面；
 * - 当前槽位 ready 后才把下一片段放进另一槽位预加载。
 */
export function syncVideoSlots(
  state: VideoSlotsState,
  active: VideoSlotDemand | null,
  next: VideoSlotDemand | null,
): VideoSlotsState {
  if (!active) {
    let result: VideoSlotsState = state.active === null ? state : { ...state, active: null };

    // 当前是图片片段时仍可提前加载下一段视频，切到视频时无需等待。
    if (next) {
      const key = pickIdleSlot(result, next);

      result = withSlot(result, key, assign(result.slots[key], next));
    }

    return result;
  }

  const activeKey = pickActiveSlot(state, active, next);
  const activeSlot = assign(state.slots[activeKey], active);
  let result = withSlot(state, activeKey, activeSlot, activeKey);
  const otherKey = otherSlot(activeKey);

  if (result.slots[activeKey].ready) {
    result = withSlot(result, otherKey, assign(result.slots[otherKey], next));
  }

  return result;
}

export function markSlotReady(state: VideoSlotsState, key: VideoSlotKey): VideoSlotsState {
  const slot = state.slots[key];

  if (!slot.assetId || (slot.ready && slot.error === null)) {
    return state;
  }

  return withSlot(state, key, { ...slot, error: null, ready: true });
}

export function markSlotFailed(
  state: VideoSlotsState,
  key: VideoSlotKey,
  error: string,
): VideoSlotsState {
  const slot = state.slots[key];

  if (!slot.assetId || (slot.error === error && !slot.ready)) {
    return state;
  }

  return withSlot(state, key, { ...slot, error, ready: false });
}

/**
 * 当前槽位未就绪时回退到另一槽已加载的画面；两者都不可用时返回 null，
 * 由预览层显示明确的加载/错误占位。
 */
export function visibleSlot(state: VideoSlotsState): VideoSlotKey | null {
  if (!state.active) {
    return null;
  }

  if (state.slots[state.active].ready) {
    return state.active;
  }

  const other = otherSlot(state.active);

  return state.slots[other].ready && state.slots[other].assetId !== null ? other : null;
}
