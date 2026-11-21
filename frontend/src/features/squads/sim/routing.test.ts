import { describe, expect, it } from 'vitest';
import type { PathingApi } from '../../pathing/sim/index';
import { traceRoute } from './routing';

function stubPathing(
  direction: (x: number, y: number) => { dx: number; dy: number } | null,
): PathingApi & { released: number[] } {
  const released: number[] = [];
  return {
    released,
    acquireGoal: () => 1,
    releaseGoal: (goalId: number) => {
      released.push(goalId);
    },
    goalRefCount: () => 1,
    directionAt: (_goalId, x, y) => direction(x, y),
    invalidateCells: () => {},
  };
}

describe('traceRoute', () => {
  it('caps the route at 512 cells, not 512 flat entries', () => {
    // A straight eastbound descent longer than 256 cells: the flat
    // (x, y) pair layout must not halve the cap.
    const pathing = stubPathing(() => ({ dx: 1, dy: 0 }));
    const route = traceRoute(pathing, 0, 0, 0, 600, 0);
    expect(route).not.toBeNull();
    expect(route?.length).toBe(513 * 2);
    expect(route?.slice(-2)).toEqual([512, 0]);
    expect(pathing.released).toEqual([1]);
  });

  it('returns the full polyline when the goal is reached inside the cap', () => {
    const pathing = stubPathing((x) => (x < 10 ? { dx: 1, dy: 0 } : null));
    const route = traceRoute(pathing, 0, 0, 0, 10, 0);
    expect(route?.length).toBe(11 * 2);
  });

  it('returns null when the start cannot reach the goal', () => {
    const pathing = stubPathing(() => null);
    expect(traceRoute(pathing, 0, 0, 0, 5, 5)).toBeNull();
    expect(pathing.released).toEqual([1]);
  });
});
