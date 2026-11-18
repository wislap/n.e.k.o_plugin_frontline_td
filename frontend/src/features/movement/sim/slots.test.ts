// Slot movement tests: slot-cell settling, formation-order preservation,
// cyclic slot reuse, the line walk helper and slot assignment invariants.
import { describe, expect, it } from 'vitest';
import { createTerrainApi } from '../../terrain/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { lineWalkable } from './line';
import { assignSlots, collectSlots, formationDesired } from './slots';
import { CLS, makeWorld, move, rejections, run, SURFACES } from './test-world';
import { makeGrid } from '../../../testing/index';
import type { SpawnUnit } from './test-world';

describe('movement slots', () => {
  it('60 units to an open point settle on distinct slot cells', () => {
    const rows = Array.from({ length: 20 }, () => '.'.repeat(20));
    const units: SpawnUnit[] = [];
    for (let i = 0; i < 60; i++) {
      units.push({ x: 2 + (i % 10), y: 2 + Math.floor(i / 10) });
    }
    const world = makeWorld(rows, units);
    world.sim.submit(move(world.handles, 12, 12));
    run(world, 900);
    const cells = new Set<string>();
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < 60; i++) {
      // active=2 means arrived and holding its slot.
      expect(world.active(i)).toBe(2);
      const p = world.pos(i);
      const cellX = Math.floor(p.x);
      const cellY = Math.floor(p.y);
      // Within 0.5 of the slot cell's centre.
      expect(Math.abs(p.x - (cellX + 0.5))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - (cellY + 0.5))).toBeLessThanOrEqual(0.5);
      cells.add(`${cellX},${cellY}`);
      cx += p.x;
      cy += p.y;
    }
    // Every unit got its own slot cell.
    expect(cells.size).toBe(60);
    // The slot set's centroid stays within 1 cell of the target centre.
    expect(Math.abs(cx / 60 - 12.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy / 60 - 12.5)).toBeLessThanOrEqual(1);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('keeps formation: a two-column group keeps its column order after moving north', () => {
    const rows = Array.from({ length: 24 }, () => '.'.repeat(24));
    const units: SpawnUnit[] = [];
    for (let i = 0; i < 20; i++) {
      units.push({ x: i < 10 ? 10 : 11, y: 20 });
    }
    const world = makeWorld(rows, units);
    world.sim.submit(move(world.handles, 10, 0));
    run(world, 600);
    let leftSum = 0;
    let rightSum = 0;
    for (let i = 0; i < 20; i++) {
      // Everyone arrived and is holding its assigned slot.
      expect(world.active(i)).toBe(2);
      const x = world.pos(i).x;
      if (i < 10) {
        leftSum += x;
      } else {
        rightSum += x;
      }
    }
    // Coarse ordering: the left column's mean stays at least one cell left
    // of the right column's mean.
    expect(leftSum / 10).toBeLessThanOrEqual(rightSum / 10 - 1);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('slots are reused cyclically for an enclosed target and units settle', () => {
    // A 3-cell pocket sealed in rock: passable but unreachable from the
    // spawn area, so only the pocket cells can serve as slots.
    const rows = [
      '##########',
      '##...#####',
      '##########',
      '..........',
      '..........',
      '##########',
    ];
    const units: SpawnUnit[] = [];
    for (let i = 0; i < 6; i++) {
      units.push({ x: 1 + i, y: 3 });
    }
    const world = makeWorld(rows, units);
    world.sim.submit(move(world.handles, 3, 1));
    // The target is passable, so the command is accepted (snapshot events
    // cover only the last tick, so check right after the command applies).
    run(world, 2);
    expect(rejections(world)).toEqual([]);
    run(world, 98);
    // Six units share at most the 3 pocket slot cells (cyclic reuse).
    const slots = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const s = world.slot(i);
      slots.add(`${Math.floor(s.x)},${Math.floor(s.y)}`);
    }
    expect(slots.size).toBeLessThanOrEqual(3);
    expect(slots.size).toBeGreaterThanOrEqual(1);
    // Nobody could reach the sealed pocket: everyone released and settled.
    for (let i = 0; i < 6; i++) {
      expect(world.active(i)).toBe(0);
    }
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });
});

describe('lineWalkable', () => {
  const terrainOf = (rows: string[]): TerrainApi => createTerrainApi(makeGrid(rows), SURFACES);

  it('is walkable across open ground', () => {
    const t = terrainOf(['..........', '..........']);
    expect(lineWalkable(t, CLS, 0.5, 0.5, 9.2, 0.5)).toBe(true);
    expect(lineWalkable(t, CLS, 0.5, 0.5, 9.5, 1.5)).toBe(true);
  });

  it('is blocked by rock on the line', () => {
    const t = terrainOf(['....#.....']);
    expect(lineWalkable(t, CLS, 0.5, 0.5, 9.5, 0.5)).toBe(false);
    // Around the rock is fine.
    expect(lineWalkable(t, CLS, 0.5, 0.5, 3.5, 0.5)).toBe(true);
  });

  it('is blocked by a cliff edge (height step without a ramp)', () => {
    const t = terrainOf(['....11111.']);
    // From height 0 onto the height-1 shelf: not a legal step.
    expect(lineWalkable(t, CLS, 2.5, 0.5, 8.5, 0.5)).toBe(false);
  });

  it('is blocked at a diagonal corner', () => {
    // (1,0) is rock: the diagonal (0,0)->(1,1) needs both orthogonal legs.
    const t = terrainOf(['.#', '..', '..']);
    expect(lineWalkable(t, CLS, 0.5, 0.5, 1.5, 1.5)).toBe(false);
    // An open diagonal with both legs free still works.
    expect(lineWalkable(t, CLS, 0.5, 1.5, 1.5, 2.5)).toBe(true);
  });
});

describe('move slots', () => {
  // No pair of units may have crossed assignments left: swapping must
  // never improve the summed squared cost to the desired points.
  function expectSwapStable(
    units: { id: number; x: number; y: number }[],
    slotCells: { x: number; y: number }[],
  ): Map<number, { x: number; y: number }> {
    const want = formationDesired(units, slotCells);
    const assigned = assignSlots(units, slotCells);
    for (let i = 0; i < units.length; i++) {
      const wi = want[i] ?? { x: 0, y: 0 };
      const si = assigned.get(units[i]?.id ?? -1) ?? { x: 0, y: 0 };
      const ii = (si.x - wi.x) * (si.x - wi.x) + (si.y - wi.y) * (si.y - wi.y);
      for (let j = i + 1; j < units.length; j++) {
        const wj = want[j] ?? { x: 0, y: 0 };
        const sj = assigned.get(units[j]?.id ?? -1) ?? { x: 0, y: 0 };
        const jj = (sj.x - wj.x) * (sj.x - wj.x) + (sj.y - wj.y) * (sj.y - wj.y);
        const ij = (sj.x - wi.x) * (sj.x - wi.x) + (sj.y - wi.y) * (sj.y - wi.y);
        const ji = (si.x - wj.x) * (si.x - wj.x) + (si.y - wj.y) * (si.y - wj.y);
        expect(ij + ji).toBeGreaterThanOrEqual(ii + jj - 1e-9);
      }
    }
    return assigned;
  }

  it('assignment is swap-stable for the two-column formation', () => {
    const units = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      x: i < 10 ? 10.5 : 11.5,
      y: 20.5,
    }));
    const cells: { x: number; y: number }[] = [];
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r) {
            cells.push({ x: 10 + dx, y: 2 + dy });
          }
        }
      }
    }
    const assigned = expectSwapStable(units, cells.slice(0, 20));
    // The columns stay ordered in the mean by at least one cell.
    let leftSum = 0;
    let rightSum = 0;
    for (const [id, p] of assigned) {
      if (id <= 10) {
        leftSum += p.x;
      } else {
        rightSum += p.x;
      }
    }
    expect(leftSum / 10).toBeLessThanOrEqual(rightSum / 10 - 1);
  });

  it('assignment is swap-stable for a 60-unit blob', () => {
    const units = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      x: 2.5 + (i % 10),
      y: 2.5 + Math.floor(i / 10),
    }));
    const cells: { x: number; y: number }[] = [];
    for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r) {
            cells.push({ x: 12 + dx, y: 12 + dy });
          }
        }
      }
    }
    expectSwapStable(units, cells.slice(0, 60));
  });

  it('collectSlots keeps only passable, goal-connected cells and caps the ring', () => {
    const grid = makeGrid(['##########', '##...#####', '##########']);
    const terrain = createTerrainApi(grid, SURFACES);
    const connected = (x: number, y: number): boolean => x >= 2 && x <= 4 && y === 1;
    const slots = collectSlots(terrain, connected, CLS, 3, 1, 8);
    // Spiral order: goal cell, then ring 1's east cell before the west one.
    expect(slots).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('assignSlots reuses slots cyclically when fewer than units', () => {
    const units = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      x: 10.5 + i,
      y: 10.5,
    }));
    const assigned = assignSlots(units, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    const cells = new Set([...assigned.values()].map((p) => `${p.x},${p.y}`));
    expect(cells.size).toBe(3);
    expect(assigned.size).toBe(6);
  });
});
