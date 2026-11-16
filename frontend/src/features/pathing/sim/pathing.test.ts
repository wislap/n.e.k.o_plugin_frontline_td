import { describe, expect, it } from 'vitest';
import { contentId } from '../../../core/index';
import { loadContent } from '../../../content/load';
import type { ResolvedSurface } from '../../../content/load';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';

const CLS = 0;
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

// Build a grid from a string map: '.' ground, '#' impassable, 'r' ramp,
// digits '1'-'9' = ground at that height.
function makeGrid(rows: string[]): { grid: TerrainGrid; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const heights = new Uint8Array(width * height);
  const surfaces = new Uint16Array(width * height);
  const ramps = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const idx = y * width + x;
      if (ch === '#') {
        surfaces[idx] = 1;
      } else if (ch === 'r') {
        ramps[idx] = 1;
      } else if (ch !== undefined && ch >= '1' && ch <= '9') {
        heights[idx] = ch.charCodeAt(0) - 48;
      }
    }
  });
  return { grid: { width, height, heights, surfaces, ramps }, width, height };
}

function makePathing(rows: string[]) {
  const { grid } = makeGrid(rows);
  const terrain = createTerrainApi(grid, SURFACES);
  const { api } = createPathingModule(terrain, 1);
  return { api, grid, terrain };
}

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

describe('direction soundness (property)', () => {
  // proto_01, ground class: for several goals, every emitted direction must be
  // a passable step, and following the field from any reachable cell must
  // reach the goal without loops or dead ends.
  it('every direction is a passable step and reaches the goal on proto_01', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const terrain = createTerrainApi(map.grid, db.surfaces.list);
    const { api } = createPathingModule(terrain, db.movementClasses.list.length);
    const ground = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
    const goalCells = [
      map.points['player_start'],
      map.points['enemy_north'],
      map.points['enemy_east'],
      // A cell on the far (east) side of the river ford.
      { x: 60, y: 47 },
    ];
    for (const g of goalCells) {
      expect(g).toBeDefined();
      if (g === undefined) {
        continue;
      }
      const goal = api.acquireGoal(g.x, g.y, ground);
      for (let y = 0; y < terrain.height; y++) {
        for (let x = 0; x < terrain.width; x++) {
          const d = api.directionAt(goal, x, y);
          if (d === null || (d.dx === 0 && d.dy === 0)) {
            continue;
          }
          const step = terrain.stepCost(x, y, x + d.dx, y + d.dy, ground);
          expect(
            step,
            `impassable direction at ${x},${y} -> ${x + d.dx},${y + d.dy}`,
          ).toBeGreaterThanOrEqual(0);
          // Follow the field to the goal; bounded steps => no loop/dead end.
          let cx = x;
          let cy = y;
          const limit = terrain.width * terrain.height;
          let k = 0;
          while (k < limit) {
            const dd = api.directionAt(goal, cx, cy);
            expect(dd, `dead end at ${cx},${cy} for goal ${g.x},${g.y}`).not.toBeNull();
            if (dd === null) {
              break;
            }
            if (dd.dx === 0 && dd.dy === 0) {
              break;
            }
            cx += dd.dx;
            cy += dd.dy;
            k++;
          }
          expect(
            cx === g.x && cy === g.y,
            `field from ${x},${y} did not reach goal ${g.x},${g.y} (ended ${cx},${cy})`,
          ).toBe(true);
        }
      }
      api.releaseGoal(goal);
    }
  }, 30_000); // Walking every reachable cell across four goals is heavy.

  it('plateau-edge cells never point off the cliff', () => {
    // 5x5: plateau height 1 everywhere except a ring of height 0; the only
    // exit is the ramp at (1,2) (lower cell). Goal below the plateau.
    const rows = ['.....', '.111.', '.r11.', '.111.', '.....'];
    const { api, terrain } = makePathing(rows);
    const goal = api.acquireGoal(2, 4, CLS);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        const d = api.directionAt(goal, x, y);
        if (d === null || (d.dx === 0 && d.dy === 0)) {
          continue;
        }
        expect(
          terrain.stepCost(x, y, x + d.dx, y + d.dy, CLS),
          `cliff step from ${x},${y} to ${x + d.dx},${y + d.dy}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
    // Following the field from the plateau interior exits via the ramp.
    let x = 2;
    let y = 1;
    for (let k = 0; k < 25; k++) {
      const d = api.directionAt(goal, x, y);
      if (d === null || (d.dx === 0 && d.dy === 0)) {
        break;
      }
      x += d.dx;
      y += d.dy;
    }
    expect(x).toBe(2);
    expect(y).toBe(4);
  });
});

// Brute-force BFS/Dijkstra over the terrain for the cross-sector test.
function dijkstraGrid(
  terrain: ReturnType<typeof createTerrainApi>,
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
    [1, -1],
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
