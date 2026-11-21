// Dynamic blockers + pathing (A4): invalidateCells reroutes flow fields
// around new walls, graphs rebuild on state load, and dijkstra's maxCost
// bounds expansion.
import { describe, expect, it } from 'vitest';
import { contentId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { createSimulation, restoreSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { baseConfig } from '../../../kernel/testing/helpers';
import { createTerrainModule } from '../../terrain/sim/index';
import { CLEARANCE_HEAVY, CLEARANCE_STANDARD } from '../../terrain/rules/index';
import type { TerrainGrid } from '../../terrain/content';
import { dijkstra, UNREACHABLE } from './dijkstra';
import { createPathingModule } from './module';
import { makeGrid } from '../../../testing/index';

const CLS = 0;
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
];

const ROCK: ResolvedSurface[] = [
  ...SURFACES,
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

function config(grid: TerrainGrid): SimConfig {
  return { ...baseConfig({ rngStreams: [] }), grid: { width: grid.width, height: grid.height } };
}

// Follows directionAt from a cell to the goal; returns the visited cells.
function walk(
  api: ReturnType<typeof createPathingModule>['api'],
  goal: number,
  x: number,
  y: number,
  limit: number,
): { x: number; y: number }[] {
  const cells = [{ x, y }];
  for (let step = 0; step < limit; step++) {
    const dir = api.directionAt(goal, x, y);
    if (dir === null) {
      return cells;
    }
    x += dir.dx;
    y += dir.dy;
    cells.push({ x, y });
    if (dir.dx === 0 && dir.dy === 0) {
      return cells;
    }
  }
  return cells;
}

describe('pathing vs blocked cells', () => {
  it('reroutes the flow field around a newly blocked wall', () => {
    const grid = makeGrid(['........', '........', '........', '........']);
    const terrain = createTerrainModule(grid, ROCK);
    const pathing = createPathingModule(terrain.api, 1);
    terrain.api.onBlockedChange((cells) => {
      pathing.api.invalidateCells(cells);
    });
    const goal = pathing.api.acquireGoal(7, 1, CLS);
    const before = walk(pathing.api, goal, 0, 3, 64);
    expect(before[before.length - 1]).toEqual({ x: 7, y: 1 });
    // Wall x=3 except a gap at y=0.
    terrain.api.setBlocked(
      [1, 2, 3].map((y) => ({ x: 3, y })),
      true,
    );
    const after = walk(pathing.api, goal, 0, 3, 64);
    expect(after[after.length - 1]).toEqual({ x: 7, y: 1 });
    expect(after).toContainEqual({ x: 3, y: 0 });
    expect(after.some((cell) => cell.x === 3 && cell.y !== 0)).toBe(false);
    // Sealing the gap makes the goal unreachable.
    terrain.api.setBlocked([{ x: 3, y: 0 }], true);
    expect(pathing.api.directionAt(goal, 0, 3)).toBeNull();
  });

  it('save/restore with blocked cells matches an uninterrupted run', () => {
    const grid = makeGrid(['........', '........', '........', '........']);
    const make = () => {
      const terrain = createTerrainModule(grid, ROCK);
      const pathing = createPathingModule(terrain.api, 1);
      terrain.api.onBlockedChange((cells) => {
        pathing.api.invalidateCells(cells);
      });
      const modules: SimModule[] = [terrain.module, pathing.module];
      return { terrain, pathing, modules };
    };
    const a = make();
    const simA = createSimulation(config(grid), a.modules);
    simA.step();
    a.terrain.api.setBlocked(
      [0, 1, 2].map((y) => ({ x: 3, y })),
      true,
    );
    const goal = a.pathing.api.acquireGoal(7, 1, CLS);
    a.pathing.api.directionAt(goal, 0, 3);
    simA.step();
    const saved = simA.serialize();
    simA.step();

    const b = make();
    const simB = restoreSimulation(config(grid), b.modules, saved);
    // Restored overlay drives rebuilt graphs: directions match.
    const probes: [number, number][] = [
      [0, 0],
      [0, 3],
      [7, 1],
      [4, 3],
    ];
    for (const [x, y] of probes) {
      const da = a.pathing.api.directionAt(goal, x, y);
      const db = b.pathing.api.directionAt(goal, x, y);
      expect(db === null ? null : { dx: db.dx, dy: db.dy }).toEqual(
        da === null ? null : { dx: da.dx, dy: da.dy },
      );
    }
    simB.step();
    expect(simB.hash()).toBe(simA.hash());
  });

  it('tier=1 invalidates cross-sector boundary portals when blocking x=16', () => {
    // 32x16 grid: wall at x=16 except a 2-cell opening at y=7..8.
    const rows = Array.from({ length: 16 }, (_, y) => {
      const line = '.'.repeat(32).split('');
      if (y !== 7 && y !== 8) {
        line[16] = '#';
      }
      return line.join('');
    });
    const grid = makeGrid(rows);
    const terrain = createTerrainModule(grid, ROCK);
    const pathing = createPathingModule(terrain.api, 1);
    terrain.api.onBlockedChange((cells) => {
      pathing.api.invalidateCells(cells);
    });

    const goal = pathing.api.acquireGoal(24, 7, CLS, CLEARANCE_HEAVY);
    // Before blocking, tier=1 routes across portal (15, 7) <-> (16, 7).
    expect(pathing.api.directionAt(goal, 2, 7)).not.toBeNull();
    // Blocking (16, 7) invalidates anchor (15, 7) and closes the portal.
    terrain.api.setBlocked([{ x: 16, y: 7 }], true);
    expect(pathing.api.directionAt(goal, 2, 7)).toBeNull();
    // Unblocking reopens the portal.
    terrain.api.setBlocked([{ x: 16, y: 7 }], false);
    expect(pathing.api.directionAt(goal, 2, 7)).not.toBeNull();
  });

  it('tier=1 invalidates diagonal sector (0,0) anchor (15,15) when blocking corner (16,16)', () => {
    // 32x32 map where the ONLY path from sector (1,0) to sector (0,1) passes
    // through sector (0,0)'s corner anchor (15,15) — which touches (16,16) in sector (1,1):
    // - Channel along x=15 (columns 15..16, rows 5..16) and y=15 (rows 15..16, cols 5..16).
    // - Wall x=17 (y=7..16) leaves v16 open only at portal (15,5)<->(16,5).
    // - Wall y=17 (x=7..16) leaves h16 open only at portal (5,15)<->(5,16).
    const gridRows = Array.from({ length: 32 }, () => '.'.repeat(32).split(''));
    const setCell = (x: number, y: number, ch: string): void => {
      const row = gridRows[y];
      if (row !== undefined) {
        row[x] = ch;
      }
    };
    for (let i = 0; i <= 14; i++) {
      setCell(14, i, '#');
      setCell(i, 14, '#');
    }
    for (let y = 0; y < 32; y++) {
      if (y < 5 || y > 16) {
        setCell(16, y, '#');
      }
    }
    for (let x = 0; x < 32; x++) {
      if (x < 5 || x > 16) {
        setCell(x, 16, '#');
      }
    }
    for (let y = 7; y <= 16; y++) {
      setCell(17, y, '#');
    }
    for (let x = 7; x <= 16; x++) {
      setCell(x, 17, '#');
    }

    const grid = makeGrid(gridRows.map((r) => r.join('')));
    const terrain = createTerrainModule(grid, ROCK);
    const pathing = createPathingModule(terrain.api, 1);
    terrain.api.onBlockedChange((cells) => {
      pathing.api.invalidateCells(cells);
    });

    // Goal in sector (0,1) at (5,20); query from sector (1,0) at (20,5).
    const goal = pathing.api.acquireGoal(5, 20, CLS, CLEARANCE_HEAVY);
    expect(pathing.api.directionAt(goal, 20, 5)).not.toBeNull();

    // Blocking (16,16) in sector (1,1) invalidates anchor (15,15) in diagonal sector (0,0).
    terrain.api.setBlocked([{ x: 16, y: 16 }], true);
    expect(pathing.api.directionAt(goal, 20, 5)).toBeNull();

    // Unblocking (16,16) restores the route through (15,15).
    terrain.api.setBlocked([{ x: 16, y: 16 }], false);
    expect(pathing.api.directionAt(goal, 20, 5)).not.toBeNull();
  });

  it('save/restore with tier=0 and tier=1 preserves hash and omits tier=0 in saved entries', () => {
    const grid = makeGrid(['..........', '..........', '..........', '..........', '..........']);
    const make = () => {
      const terrain = createTerrainModule(grid, ROCK);
      const pathing = createPathingModule(terrain.api, 1);
      terrain.api.onBlockedChange((cells) => {
        pathing.api.invalidateCells(cells);
      });
      const modules: SimModule[] = [terrain.module, pathing.module];
      return { terrain, pathing, modules };
    };
    const a = make();
    const simA = createSimulation(config(grid), a.modules);
    simA.step();
    const g0 = a.pathing.api.acquireGoal(8, 2, CLS, CLEARANCE_STANDARD);
    const g1 = a.pathing.api.acquireGoal(7, 2, CLS, CLEARANCE_HEAVY);
    a.pathing.api.directionAt(g0, 1, 1);
    a.pathing.api.directionAt(g1, 1, 1);
    simA.step();

    const saved = simA.serialize();
    const savedGoals =
      (
        saved as {
          moduleStates: Record<string, { entries: Array<Record<string, unknown>> }>;
        }
      ).moduleStates['frontline_td:pathing.goals']?.entries ?? [];
    expect(savedGoals).toHaveLength(2);
    const entry0 = savedGoals.find((e) => e['id'] === g0);
    const entry1 = savedGoals.find((e) => e['id'] === g1);
    expect(entry0).toBeDefined();
    expect(entry1).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(entry0, 'tier')).toBe(false);
    expect(entry1?.['tier']).toBe(CLEARANCE_HEAVY);

    simA.step();

    const b = make();
    const simB = restoreSimulation(config(grid), b.modules, saved);
    for (const [x, y] of [
      [1, 1],
      [4, 2],
      [7, 2],
    ] as const) {
      const da0 = a.pathing.api.directionAt(g0, x, y);
      const db0 = b.pathing.api.directionAt(g0, x, y);
      expect(db0 === null ? null : { dx: db0.dx, dy: db0.dy }).toEqual(
        da0 === null ? null : { dx: da0.dx, dy: da0.dy },
      );
      const da1 = a.pathing.api.directionAt(g1, x, y);
      const db1 = b.pathing.api.directionAt(g1, x, y);
      expect(db1 === null ? null : { dx: db1.dx, dy: db1.dy }).toEqual(
        da1 === null ? null : { dx: da1.dx, dy: da1.dy },
      );
      const sa1 = a.pathing.api.smoothDirectionAt(g1, x + 0.8, y + 0.8);
      const sb1 = b.pathing.api.smoothDirectionAt(g1, x + 0.8, y + 0.8);
      expect(sb1 === null ? null : { dx: sb1.dx, dy: sb1.dy }).toEqual(
        sa1 === null ? null : { dx: sa1.dx, dy: sa1.dy },
      );
    }
    simB.step();
    expect(simB.hash()).toBe(simA.hash());
  });
});

describe('dijkstra maxCost', () => {
  // Line graph 0-1-2-3-4 with unit edges.
  const neighbors = (node: number, visit: (to: number, cost: number) => void): void => {
    if (node > 0) {
      visit(node - 1, 1);
    }
    if (node < 4) {
      visit(node + 1, 1);
    }
  };

  it('stops expanding beyond the bound', () => {
    const dist = dijkstra(5, [[0, 0]], neighbors, 2);
    expect([...dist]).toEqual([0, 1, 2, UNREACHABLE, UNREACHABLE]);
  });

  it('matches the unbounded result within the bound', () => {
    const full = dijkstra(5, [[0, 0]], neighbors);
    const bounded = dijkstra(5, [[0, 0]], neighbors, 10);
    expect([...bounded]).toEqual([...full]);
  });
});
