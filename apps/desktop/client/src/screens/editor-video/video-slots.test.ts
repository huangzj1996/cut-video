import { describe, expect, it } from 'vitest';
import {
  createVideoSlots,
  markSlotFailed,
  markSlotReady,
  slotForClip,
  syncVideoSlots,
  visibleSlot,
} from './video-slots';

const ACTIVE = { assetId: 'asset-1', clipId: 'clip-1' };
const NEXT = { assetId: 'asset-2', clipId: 'clip-2' };
const THIRD = { assetId: 'asset-3', clipId: 'clip-3' };
const FOURTH = { assetId: 'asset-4', clipId: 'clip-4' };

describe('syncVideoSlots', () => {
  it('assigns the active clip before preloading the next one', () => {
    const initial = syncVideoSlots(createVideoSlots(), ACTIVE, NEXT);

    expect(slotForClip(initial, 'clip-1')).toBe('a');
    expect(slotForClip(initial, 'clip-2')).toBeNull();
    expect(initial.active).toBe('a');

    const ready = syncVideoSlots(markSlotReady(initial, 'a'), ACTIVE, NEXT);

    expect(slotForClip(ready, 'clip-1')).toBe('a');
    expect(slotForClip(ready, 'clip-2')).toBe('b');
    expect(ready.slots.b.ready).toBe(false);
  });

  it('swaps to the preloaded clip and reuses the old slot for the following clip', () => {
    let state = syncVideoSlots(createVideoSlots(), ACTIVE, NEXT);

    state = syncVideoSlots(markSlotReady(state, 'a'), ACTIVE, NEXT);
    state = syncVideoSlots(markSlotReady(state, 'b'), ACTIVE, NEXT);
    state = syncVideoSlots(state, NEXT, THIRD);

    expect(state.active).toBe('b');
    expect(state.slots.b).toMatchObject({ assetId: 'asset-2', clipId: 'clip-2', ready: true });
    expect(state.slots.a).toMatchObject({ assetId: 'asset-3', clipId: 'clip-3', ready: false });
  });

  it('keeps a loaded element when the next clip uses the same asset', () => {
    let state = syncVideoSlots(createVideoSlots(), ACTIVE, NEXT);

    state = syncVideoSlots(markSlotReady(state, 'a'), ACTIVE, NEXT);
    state = syncVideoSlots(markSlotReady(state, 'b'), ACTIVE, NEXT);
    const sameAsset = { assetId: 'asset-2', clipId: 'clip-2b' };
    const swapped = syncVideoSlots(state, sameAsset, null);

    expect(swapped.active).toBe('b');
    expect(swapped.slots.b).toMatchObject({ clipId: 'clip-2b', ready: true });
  });

  it('keeps the previous frame visible while a seek target loads', () => {
    let state = syncVideoSlots(createVideoSlots(), ACTIVE, NEXT);

    state = syncVideoSlots(markSlotReady(state, 'a'), ACTIVE, NEXT);
    state = syncVideoSlots(markSlotReady(state, 'b'), ACTIVE, NEXT);
    state = syncVideoSlots(state, THIRD, FOURTH);

    expect(state.active).toBe('b');
    expect(state.slots.b).toMatchObject({ assetId: 'asset-3', ready: false });
    // 旧画面仍在 a，等 b 加载完成前不能变黑。
    expect(state.slots.a).toMatchObject({ assetId: 'asset-1', ready: true });
    expect(visibleSlot(state)).toBe('a');

    state = syncVideoSlots(markSlotReady(state, 'b'), THIRD, FOURTH);

    expect(visibleSlot(state)).toBe('b');
    expect(slotForClip(state, 'clip-4')).toBe('a');
  });

  it('preloads the next video while a static image is on screen', () => {
    const state = syncVideoSlots(createVideoSlots(), null, NEXT);

    expect(state.active).toBeNull();
    expect(slotForClip(state, 'clip-2')).toBe('a');
    expect(visibleSlot(state)).toBeNull();
  });

  it('clears the stale slot when there is nothing left to preload', () => {
    let state = syncVideoSlots(createVideoSlots(), ACTIVE, NEXT);

    state = syncVideoSlots(markSlotReady(state, 'a'), ACTIVE, NEXT);
    state = syncVideoSlots(state, ACTIVE, null);

    expect(state.slots.b).toMatchObject({ assetId: null, clipId: null, ready: false });
  });

  it('shows the previous frame when the active clip fails to load', () => {
    let state = syncVideoSlots(createVideoSlots(), ACTIVE, NEXT);

    state = syncVideoSlots(markSlotReady(state, 'a'), ACTIVE, NEXT);
    state = syncVideoSlots(markSlotReady(state, 'b'), ACTIVE, NEXT);
    state = syncVideoSlots(state, THIRD, null);
    state = markSlotFailed(state, 'b', '解码失败');

    expect(state.slots.b).toMatchObject({ error: '解码失败', ready: false });
    expect(visibleSlot(state)).toBe('a');
  });
});

describe('markSlotReady', () => {
  it('is a no-op for unknown slots', () => {
    const state = createVideoSlots();

    expect(markSlotReady(state, 'a')).toBe(state);
  });

  it('clears a previous error', () => {
    let state = syncVideoSlots(createVideoSlots(), ACTIVE, null);

    state = markSlotFailed(state, 'a', '解码失败');
    state = markSlotReady(state, 'a');

    expect(state.slots.a).toMatchObject({ error: null, ready: true });
  });
});
