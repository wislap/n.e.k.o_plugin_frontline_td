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
