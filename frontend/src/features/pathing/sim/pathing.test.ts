import { describe, expect, it } from 'vitest';
import { CLEARANCE_HEAVY, CLEARANCE_STANDARD } from '../../terrain/rules/index';
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

describe('clearance tiers and smoothDirectionAt', () => {
  it('routes tier=1 through a 2-cell corridor while tier=0 uses a 1-cell shortcut', () => {
    // 16x10 map, wall at x=8 with:
    // - 1-cell narrow gap at y=1
    // - 2-cell wide gap at y=6..7
    const rows = Array.from({ length: 10 }, (_, y) => {
      const line = '.'.repeat(16).split('');
      if (y !== 1 && y !== 6 && y !== 7) {
        line[8] = '#';
      }
      return line.join('');
    });
    const { api } = makePathing(rows);
    const goal0 = api.acquireGoal(12, 1, CLS, CLEARANCE_STANDARD);
    const goal1 = api.acquireGoal(12, 1, CLS, CLEARANCE_HEAVY);

    // (x, y, cls, 0) and (x, y, cls, 1) keep independent ref-counted IDs.
    expect(goal0).not.toBe(goal1);
    expect(api.goalRefCount(goal0)).toBe(1);
    expect(api.goalRefCount(goal1)).toBe(1);
    const goal0Again = api.acquireGoal(12, 1, CLS, CLEARANCE_STANDARD);
    expect(goal0Again).toBe(goal0);
    expect(api.goalRefCount(goal0)).toBe(2);
    expect(api.goalRefCount(goal1)).toBe(1);
    api.releaseGoal(goal0Again);

    // Walk tier=0 from (4, 1): takes the 1-cell gap at y=1.
    let x0 = 4;
    let y0 = 1;
    const path0: [number, number][] = [[x0, y0]];
    for (let k = 0; k < 32; k++) {
      const d = api.directionAt(goal0, x0, y0);
      expect(d).not.toBeNull();
      if (d === null || (d.dx === 0 && d.dy === 0)) {
        break;
      }
      x0 += d.dx;
      y0 += d.dy;
      path0.push([x0, y0]);
    }
    expect([x0, y0]).toEqual([12, 1]);
    expect(path0.some(([x, y]) => x === 8 && y === 1)).toBe(true);
    expect(path0.every(([, y]) => y <= 2)).toBe(true);

    // Walk tier=1 from (4, 1): cannot fit through y=1, detours via y=6..7.
    let x1 = 4;
    let y1 = 1;
    const path1: [number, number][] = [[x1, y1]];
    for (let k = 0; k < 64; k++) {
      const d = api.directionAt(goal1, x1, y1);
      expect(d).not.toBeNull();
      if (d === null || (d.dx === 0 && d.dy === 0)) {
        break;
      }
      x1 += d.dx;
      y1 += d.dy;
      path1.push([x1, y1]);
    }
    expect([x1, y1]).toEqual([12, 1]);
    expect(path1.some(([x, y]) => x === 8 && y === 6)).toBe(true);

    // Releasing goal0 does not affect goal1.
    api.releaseGoal(goal0);
    expect(api.goalRefCount(goal0)).toBe(0);
    expect(api.goalRefCount(goal1)).toBe(1);
    expect(api.directionAt(goal1, 4, 1)).not.toBeNull();
  });

  it('smoothDirectionAt returns continuous off-axis unit vectors without mutating directionAt', () => {
    const rows = Array.from({ length: 16 }, () => '.'.repeat(16));
    const { api } = makePathing(rows);
    const goal = api.acquireGoal(13, 10, CLS, CLEARANCE_STANDARD);

    // Off-axis point (3.5, 4.5): vector should be unit-length and not quantized to 45 deg.
    const d = api.smoothDirectionAt(goal, 3.5, 4.5);
    expect(d).not.toBeNull();
    if (d === null) {
      return;
    }
    const len = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
    expect(len).toBeCloseTo(1, 5);
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBeGreaterThan(0);
    expect(Math.abs(d.dx - d.dy)).toBeGreaterThan(0.05);

    // Continuous variation across sub-cell offsets near the 45-degree diagonal cone edge.
    const samples: { dx: number; dy: number }[] = [];
    for (const offset of [0.55, 0.65, 0.75, 0.85, 0.95]) {
      const s = api.smoothDirectionAt(goal, 7.7, 4 + offset);
      expect(s).not.toBeNull();
      if (s !== null) {
        expect(Math.sqrt(s.dx * s.dx + s.dy * s.dy)).toBeCloseTo(1, 5);
        samples.push({ dx: s.dx, dy: s.dy });
      }
    }
    expect(new Set(samples.map((s) => `${s.dx.toFixed(4)},${s.dy.toFixed(4)}`)).size).toBe(
      samples.length,
    );
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const curr = samples[i];
      if (prev !== undefined && curr !== undefined) {
        const diff = Math.sqrt(
          (curr.dx - prev.dx) * (curr.dx - prev.dx) + (curr.dy - prev.dy) * (curr.dy - prev.dy),
        );
        expect(diff).toBeLessThan(0.15);
      }
    }

    // Never mutates directionAt's scratch object (and vice versa).
    const disc = api.directionAt(goal, 3, 4);
    expect(disc).not.toBeNull();
    if (disc === null) {
      return;
    }
    const savedDisc = { dx: disc.dx, dy: disc.dy };
    const smooth = api.smoothDirectionAt(goal, 3.25, 4.75);
    expect(disc.dx).toBe(savedDisc.dx);
    expect(disc.dy).toBe(savedDisc.dy);
    expect(smooth).not.toBeNull();
    if (smooth !== null) {
      const savedSmooth = { dx: smooth.dx, dy: smooth.dy };
      api.directionAt(goal, 2, 2);
      expect(smooth.dx).toBe(savedSmooth.dx);
      expect(smooth.dy).toBe(savedSmooth.dy);
    }

    // Returns { 0, 0 } on goal cell for both tier=0 and tier=1.
    expect(api.smoothDirectionAt(goal, 13.2, 10.8)).toEqual({ dx: 0, dy: 0 });
    const goalHeavy = api.acquireGoal(12, 10, CLS, CLEARANCE_HEAVY);
    expect(api.smoothDirectionAt(goalHeavy, 12.6, 10.6)).toEqual({ dx: 0, dy: 0 });
    expect(api.smoothDirectionAt(goalHeavy, 13.4, 11.4)).toEqual({ dx: 0, dy: 0 });
  });

  it('smoothDirectionAt returns null when unreachable and never points into walls or cliffs', () => {
    // Unreachable region
    const { api: wallApi } = makePathing(['........', '########', '........']);
    const unreachableGoal = wallApi.acquireGoal(6, 2, CLS);
    expect(wallApi.smoothDirectionAt(unreachableGoal, 1.5, 0.5)).toBeNull();
    expect(wallApi.smoothDirectionAt(unreachableGoal, -0.5, 0.5)).toBeNull();
    expect(wallApi.smoothDirectionAt(999, 1.5, 0.5)).toBeNull();

    // Wall avoidance: cell (3, 1) adjacent to wall at (4, 1), goal at (3, 5).
    const wallRows = ['........', '....#...', '....#...', '....#...', '........', '........'];
    const { api: corridorApi } = makePathing(wallRows);
    const cg = corridorApi.acquireGoal(5, 5, CLS);
    for (const [px, py] of [
      [3.8, 1.5],
      [3.8, 2.5],
      [3.8, 3.2],
    ] as const) {
      const d = corridorApi.smoothDirectionAt(cg, px, py);
      expect(d).not.toBeNull();
      if (d !== null) {
        // Adjacent to the wall at x=4: must not point East into the wall.
        expect(d.dx).toBeLessThanOrEqual(0.001);
      }
    }

    // Cliff avoidance: 5x5 plateau with ramp at (1, 2).
    const cliffRows = ['.....', '.111.', '.r11.', '.111.', '.....'];
    const { api: cliffApi, terrain: cliffTerrain } = makePathing(cliffRows);
    const cliffGoal = cliffApi.acquireGoal(2, 4, CLS);
    // Probe plateau cells near cliff edges: integrating 0.25 must stay passable / never step off cliff.
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        for (const ox of [0.25, 0.75]) {
          for (const oy of [0.25, 0.75]) {
            const px = x + ox;
            const py = y + oy;
            const d = cliffApi.smoothDirectionAt(cliffGoal, px, py);
            expect(d).not.toBeNull();
            if (d === null || (d.dx === 0 && d.dy === 0)) {
              continue;
            }
            const nx = Math.floor(px + d.dx * 0.25);
            const ny = Math.floor(py + d.dy * 0.25);
            if (nx !== x || ny !== y) {
              expect(cliffTerrain.stepCost(x, y, nx, ny, CLS)).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
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
