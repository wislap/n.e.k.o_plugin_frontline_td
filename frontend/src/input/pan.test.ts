import { describe, expect, it } from 'vitest';
import { createPanTracker } from './pan';

describe('pan tracker', () => {
  it('returns a normalized vector from held keys', () => {
    const t = createPanTracker();
    expect(t.panVector()).toEqual({ x: 0, y: 0 });
    t.handleKeyDown('KeyW');
    expect(t.panVector()).toEqual({ x: 0, y: -1 });
    t.handleKeyDown('KeyD');
    const v = t.panVector();
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2, 6);
    t.handleKeyUp('KeyW');
    expect(t.panVector()).toEqual({ x: 1, y: 0 });
    t.handleKeyUp('KeyD');
    expect(t.panVector()).toEqual({ x: 0, y: 0 });
  });

  it('ignores non-pan keys and clears on reset', () => {
    const t = createPanTracker();
    t.handleKeyDown('Space');
    t.handleKeyDown('ArrowLeft');
    expect(t.panVector()).toEqual({ x: -1, y: 0 });
    t.reset();
    expect(t.panVector()).toEqual({ x: 0, y: 0 });
  });
});
