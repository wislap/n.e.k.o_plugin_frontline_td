import { describe, expect, it } from 'vitest';
import type { PathingApi } from '../../pathing/sim/index';
import { traceRoute } from './routing';

const ROUTE_MAX_CELLS = 512;

interface CellDir {
  dx: number;
  dy: number;
}

function makeGridPathing(dirs: ReadonlyMap<string, CellDir>): {
  pathing: PathingApi;
  released: number[];
} {
  let nextGoal = 1;
  const released: number[] = [];
  const pathing: PathingApi = {
    acquireGoal: () => nextGoal++,
    releaseGoal: (goalId) => {
      released.push(goalId);
    },
    goalRefCount: () => 1,
    reachable: () => true,
    distanceAt: () => null,
    directionAt: (_goalId, x, y) => dirs.get(`${x},${y}`) ?? null,
    smoothDirectionAt: () => null,
    invalidateCells: () => undefined,
  };
  return { pathing, released };
}

describe('traceRoute', () => {
  it('caps a >520-cell snake corridor at ROUTE_MAX_CELLS points (1024 numbers)', () => {
    const width = 30;
    const rows = 20; // 600 cells total
    const snake: Array<[number, number]> = [];
    for (let y = 0; y < rows; y++) {
      if (y % 2 === 0) {
        for (let x = 0; x < width; x++) snake.push([x, y]);
      } else {
        for (let x = width - 1; x >= 0; x--) snake.push([x, y]);
      }
    }

    const dirs = new Map<string, CellDir>();
    for (let i = 0; i < snake.length - 1; i++) {
      const [cx, cy] = snake[i] ?? [0, 0];
      const [nx, ny] = snake[i + 1] ?? [0, 0];
      dirs.set(`${cx},${cy}`, { dx: nx - cx, dy: ny - cy });
    }
    const [gx, gy] = snake[snake.length - 1] ?? [0, 0];
    dirs.set(`${gx},${gy}`, { dx: 0, dy: 0 });

    const { pathing, released } = makeGridPathing(dirs);
    const route = traceRoute(pathing, 0, 0.5, 0.5, gx + 0.5, gy + 0.5);

    expect(route).not.toBeNull();
    expect(route?.length).toBeLessThanOrEqual(ROUTE_MAX_CELLS * 2);
    expect(route?.length).toBe(ROUTE_MAX_CELLS * 2);
    expect(route?.slice(0, 4)).toEqual([0, 0, 1, 0]);
    expect(released).toEqual([1]);
  });

  it('traces normal short routes cleanly to (tx, ty)', () => {
    const dirs = new Map<string, CellDir>([
      ['1,1', { dx: 1, dy: 0 }],
      ['2,1', { dx: 1, dy: 0 }],
      ['3,1', { dx: 0, dy: 1 }],
      ['3,2', { dx: 0, dy: 0 }],
    ]);
    const { pathing, released } = makeGridPathing(dirs);
    const route = traceRoute(pathing, 0, 1.5, 1.5, 3.5, 2.5);

    expect(route).toEqual([1, 1, 2, 1, 3, 1, 3, 2]);
    expect(released).toEqual([1]);
  });

  it('returns null and releases the goal when start is unreachable', () => {
    const { pathing, released } = makeGridPathing(new Map());
    expect(traceRoute(pathing, 0, 0.5, 0.5, 5.5, 5.5)).toBeNull();
    expect(released).toEqual([1]);
  });
});
