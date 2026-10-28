import { describe, expect, it } from 'vitest';
import { reorderTargetIndex, type ReorderSceneSpan } from './reorder-drag';

const SCENES: ReorderSceneSpan[] = [
  { endSeconds: 4, id: 'scene-1', startSeconds: 0 },
  { endSeconds: 8, id: 'scene-2', startSeconds: 4 },
  { endSeconds: 12, id: 'scene-3', startSeconds: 8 },
];

describe('reorderTargetIndex', () => {
  it('keeps the scene in place while the pointer stays before the next midpoint', () => {
    expect(reorderTargetIndex(SCENES, 'scene-1', 1)).toBe(0);
    expect(reorderTargetIndex(SCENES, 'scene-1', 5)).toBe(0);
  });

  it('moves a scene right once the pointer passes the next scene midpoint', () => {
    expect(reorderTargetIndex(SCENES, 'scene-1', 7)).toBe(1);
    expect(reorderTargetIndex(SCENES, 'scene-1', 11)).toBe(2);
  });

  it('moves a scene left once the pointer passes the previous scene midpoint', () => {
    expect(reorderTargetIndex(SCENES, 'scene-3', 1)).toBe(0);
    expect(reorderTargetIndex(SCENES, 'scene-3', 3)).toBe(1);
    expect(reorderTargetIndex(SCENES, 'scene-3', 11)).toBe(2);
  });

  it('clamps the target inside the scene list', () => {
    expect(reorderTargetIndex(SCENES, 'scene-2', -5)).toBe(0);
    expect(reorderTargetIndex(SCENES, 'scene-2', 500)).toBe(2);
  });

  it('returns null when the dragged scene is not in the list', () => {
    expect(reorderTargetIndex(SCENES, 'scene-missing', 3)).toBeNull();
  });
});
