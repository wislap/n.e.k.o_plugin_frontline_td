import { describe, expect, it } from 'vitest';
import { CLS, makePathing } from './test-world';

function follow(api: ReturnType<typeof makePathing>['api'], goal: number, x: number, y: number) {
  return api.directionAt(goal, x, y);
}

describe('pathing flow fields', () => {
  it('guides along a straight corridor', () => {
    const { api } = makePathing(['........................']);
    const goal = api.acquireGoal(20, 0, CLS);
    const d = follow(api, goal, 1, 0);
    expect(d).toEqual({ dx: 1, dy: 0 });
  });

  it('routes through the only gap in a wall', () => {
    // 8-high wall at x=8, gap at y=4; map 24x8.
    const rows = Array.from({ length: 8 }, (_, y) => {
      const line = '.'.repeat(24).split('');
      if (y !== 4) {
        line[8] = '#';
      }
      return line.join('');
    });
    const { api } = makePathing(rows);
    const goal = api.acquireGoal(20, 4, CLS);
    // Cell just left of the wall below the gap should point up-ish toward gap.
    const d = follow(api, goal, 7, 6);
    expect(d).not.toBeNull();
    expect(d?.dx).toBeGreaterThanOrEqual(0);
    expect(d?.dy).toBeLessThanOrEqual(0);
    // Cell directly at the gap column below should also route up.
    const d2 = follow(api, goal, 7, 5);
    expect(d2?.dy).toBe(-1);
  });

  it('crosses 3+ sectors at near-optimal cost', () => {
    // 64x16 open map; goal at far right. Portal approximation may add a small
    // detour (portal midpoints instead of any boundary cell): allow up to 2
    // crossing-edge costs of slack per sector hop (~40 cost on this map).
    const rows = Array.from({ length: 16 }, () => '.'.repeat(64));
    const { api, terrain } = makePathing(rows);
    const goal = api.acquireGoal(60, 8, CLS);
    // True shortest path cost on the grid (BFS over stepCost).
    const dist = dijkstraGrid(terrain, 60, 8);
    // Follow the field from (1,1) accumulating actual step costs.
    let x = 1;
    let y = 1;
    let cost = 0;
    for (let k = 0; k < 500; k++) {
      const d = api.directionAt(goal, x, y);
      expect(d, `stuck at ${x},${y}`).not.toBeNull();
      if (d === null) {
        break;
      }
      if (d.dx === 0 && d.dy === 0) {
        break;
      }
      const nx = x + d.dx;
      const ny = y + d.dy;
      const c = terrain.stepCost(x, y, nx, ny, CLS);
      expect(c).toBeGreaterThanOrEqual(0);
      cost += c;
      x = nx;
      y = ny;
    }
    expect(x).toBe(60);
    expect(y).toBe(8);
    const optimal = dist[8 * 64 + 1] ?? -1;
    // Tolerance: portal midpoint approximation can add <= 2 sector hops x
    // half a boundary width each; on flat ground cost 10 -> allow 320.
    expect(cost - optimal).toBeLessThanOrEqual(320);
  });

  it('returns null for an unreachable goal', () => {
    const rows = ['........', '########', '........'];
    const { api } = makePathing(rows);
    const goal = api.acquireGoal(6, 2, CLS);
    expect(api.directionAt(goal, 1, 0)).toBeNull();
  });

  it('ref-counts goals and reuses the lowest free id', () => {
    const { api } = makePathing(['................']);
    const a = api.acquireGoal(3, 0, CLS);
    const b = api.acquireGoal(3, 0, CLS);
    expect(a).toBe(b);
    expect(api.goalRefCount(a)).toBe(2);
    api.releaseGoal(a);
    expect(api.goalRefCount(a)).toBe(1);
    api.acquireGoal(5, 0, CLS);
    api.releaseGoal(a);
    expect(api.goalRefCount(a)).toBe(0);
    const d = api.acquireGoal(7, 0, CLS);
    expect(d).toBe(a); // lowest free id reused
  });

  it('invalidation opens new routes and closes old ones', () => {
    // 24x8, wall x=8 with no gap initially.
    const { grid, api } = makePathing(
      Array.from({ length: 8 }, () => '.'.repeat(8) + '#' + '.'.repeat(15)),
    );
    const goal = api.acquireGoal(20, 4, CLS);
    expect(api.directionAt(goal, 1, 4)).toBeNull();
    // Open a gap at (8,4) then invalidate that cell.
    grid.surfaces[4 * 24 + 8] = 0;
    api.invalidateCells([{ x: 8, y: 4 }]);
    const d = api.directionAt(goal, 1, 4);
    expect(d).not.toBeNull();
    expect(d?.dx).toBe(1);
    // Close it again.
    grid.surfaces[4 * 24 + 8] = 1;
    api.invalidateCells([{ x: 8, y: 4 }]);
    expect(api.directionAt(goal, 1, 4)).toBeNull();
  });

  it('is deterministic: same inputs give identical direction arrays', () => {
    const rows = Array.from({ length: 32 }, () => '.'.repeat(48));
    const run = (): string => {
      const { api } = makePathing(rows);
      const goal = api.acquireGoal(40, 20, CLS);
      const out: string[] = [];
      for (let y = 0; y < 32; y += 5) {
        for (let x = 0; x < 48; x += 5) {
          const d = api.directionAt(goal, x, y);
          out.push(d === null ? 'x' : `${d.dx},${d.dy}`);
        }
      }
      return out.join('|');
    };
    expect(run()).toBe(run());
  });
});

// Brute-force BFS/Dijkstra over the terrain for the cross-sector test.
function dijkstraGrid(
  terrain: ReturnType<typeof makePathing>['terrain'],
  gx: number,
  gy: number,
): Int32Array {
  const w = terrain.width;
  const h = terrain.height;
  const dist = new Int32Array(w * h).fill(-1);
  dist[gy * w + gx] = 0;
  const queue: number[] = [gy * w + gx];
  const DIRS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ] as const;
  while (queue.length > 0) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) {
      if ((dist[queue[i] ?? 0] ?? -1) < (dist[queue[bi] ?? 0] ?? -1)) {
        bi = i;
      }
    }
    const cell = queue.splice(bi, 1)[0] ?? 0;
    const cx = cell % w;
    const cy = Math.floor(cell / w);
    const d = dist[cell] ?? 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const cost = terrain.stepCost(cx, cy, nx, ny, CLS);
      if (cost < 0) {
        continue;
      }
      const key = ny * w + nx;
      const prev = dist[key] ?? -1;
      if (prev === -1 || d + cost < prev) {
        dist[key] = d + cost;
        queue.push(key);
      }
    }
  }
  return dist;
}
