// Dynamic blockers + movement (A4): blocked cells are impassable, so no unit
// enters or is pushed into one (the shared harness asserts passability every
// tick), and a sealed destination makes movers stop.
import { describe, expect, it } from 'vitest';
import { makeWorld, move, run } from './test-world';

const OPEN_8x6 = ['........', '........', '........', '........', '........', '........'];

function blockedCells(world: ReturnType<typeof makeWorld>): number[] {
  const out: number[] = [];
  for (let y = 0; y < world.terrain.height; y++) {
    for (let x = 0; x < world.terrain.width; x++) {
      if (world.terrain.blocked(x, y)) {
        out.push(y * world.terrain.width + x);
      }
    }
  }
  return out;
}

describe('movement vs blocked cells', () => {
  it('routes around a wall through the gap and never enters a blocked cell', () => {
    const world = makeWorld(OPEN_8x6, [{ x: 0, y: 2 }]);
    // Wall across x=3 with a gap at y=0.
    world.terrain.setBlocked(
      [1, 2, 3, 4, 5].map((y) => ({ x: 3, y })),
      true,
    );
    world.sim.submit(move(world.handles, 6, 2));
    run(world, 300);
    expect(world.active(0)).not.toBe(1);
    const cell = Math.floor(world.pos(0).y) * 8 + Math.floor(world.pos(0).x);
    expect(blockedCells(world)).not.toContain(cell);
    // It arrived at a slot near (6,2), i.e. it crossed the gap, not the wall.
    expect(world.pos(0).x).toBeGreaterThan(3.5);
  });

  it('stops units when the destination becomes sealed', () => {
    const world = makeWorld(OPEN_8x6, [{ x: 0, y: 2 }]);
    world.sim.submit(move(world.handles, 6, 2));
    run(world, 5);
    // Seal the destination column entirely before the unit crosses it.
    world.terrain.setBlocked(
      [0, 1, 2, 3, 4, 5].map((y) => ({ x: 4, y })),
      true,
    );
    run(world, 200);
    expect(world.active(0)).toBe(0);
    expect(world.pos(0).x).toBeLessThan(4);
    const cell = Math.floor(world.pos(0).y) * 8 + Math.floor(world.pos(0).x);
    expect(blockedCells(world)).not.toContain(cell);
  });

  it('separation never pushes a crowd into blocked cells', () => {
    const rows = OPEN_8x6;
    const world = makeWorld(
      rows,
      Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: 1 })),
    );
    // Column of blocked cells right of the group.
    world.terrain.setBlocked(
      [0, 1, 2, 3, 4, 5].map((y) => ({ x: 6, y })),
      true,
    );
    world.sim.submit(move(world.handles, 5, 2));
    run(world, 400);
    const blocked = new Set(blockedCells(world));
    for (let i = 0; i < world.handles.length; i++) {
      const cell = Math.floor(world.pos(i).y) * 8 + Math.floor(world.pos(i).x);
      expect(blocked.has(cell)).toBe(false);
    }
  });

  it('stops a tier=1 heavy mover on its 2x2 bank when a 2-wide bridge narrows to 1-wide', () => {
    const rows = [
      '.....#......',
      '.....#......',
      '............',
      '............',
      '.....#......',
      '.....#......',
    ];
    const world = makeWorld(rows, [{ x: 1, y: 2, radius: 0.8 }]);
    world.sim.submit(move(world.handles, 9, 2));
    run(world, 6);
    // Narrow the 2-wide bridge at x=5, y=2..3 down to 1-wide by blocking (5, 3).
    world.terrain.setBlocked([{ x: 5, y: 3 }], true);
    run(world, 200);
    expect(world.active(0)).toBe(0);
    // Must stay on its legal 2x2 bank west of x=5 without entering the 1-wide choke.
    expect(world.pos(0).x).toBeLessThan(5);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });
});
