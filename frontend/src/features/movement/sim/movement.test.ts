// Movement behaviour tests (B5): goal arrival, separation, crowding,
// passability property, command rejections, goal release, determinism.
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../../../core/index';
import { F1, makeWorld, move, rejections, run } from './test-world';
import type { SpawnUnit } from './test-world';

describe('movement', () => {
  it('single unit reaches a target around a wall', () => {
    const rows = Array.from({ length: 8 }, (_, y) => {
      const line = '.'.repeat(16).split('');
      if (y !== 4) {
        line[8] = '#';
      }
      return line.join('');
    });
    const world = makeWorld(rows, [{ x: 2, y: 4 }]);
    world.sim.submit(move(world.handles, 13, 4));
    run(world, 400);
    const p = world.pos(0);
    expect(Math.abs(p.x - 13.5)).toBeLessThan(0.9);
    expect(Math.abs(p.y - 4.5)).toBeLessThan(0.9);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('two units with opposite targets in a corridor do not overlap permanently', () => {
    const world = makeWorld(
      ['..........'],
      [
        { x: 1, y: 0 },
        { x: 8, y: 0 },
      ],
    );
    world.sim.submit(move([world.handles[0] ?? (0 as EntityHandle)], 8, 0));
    world.sim.submit(move([world.handles[1] ?? (0 as EntityHandle)], 1, 0));
    let minDist = Infinity;
    for (let t = 0; t < 300; t++) {
      world.sim.step();
      const a = world.pos(0);
      const b = world.pos(1);
      const ddx = a.x - b.x;
      const ddy = a.y - b.y;
      minDist = Math.min(minDist, Math.sqrt(ddx * ddx + ddy * ddy));
    }
    const a = world.pos(0);
    const b = world.pos(1);
    const ddx = a.x - b.x;
    const ddy = a.y - b.y;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    // Head-on in a 1-wide corridor: separation balances against the inward
    // steer so a slight overlap persists while they push past each other —
    // the invariant is no permanent coincidence (dist stays > 0).
    expect(dist).toBeGreaterThan(0.3);
    expect(minDist).toBeGreaterThan(0.2);
  });

  it('units never cross a cliff edge (property over a scripted run)', () => {
    // Plateau h1 in the middle with a single ramp; units must descend via it.
    const rows = [
      '..........',
      '.11111111.',
      '.11111111.',
      '.11111111.',
      '.r1111111.',
      '..........',
    ];
    const world = makeWorld(rows, [{ x: 5, y: 2 }]);
    world.sim.submit(move(world.handles, 5, 5));
    // The check system inside makeWorld throws if any cell is impassable;
    // 300 ticks is enough to leave the plateau through the ramp.
    run(world, 300);
    const p = world.pos(0);
    expect(Math.abs(p.y - 5.5)).toBeLessThan(1.0);
  });

  it('rejects invalid targets and empty selections', () => {
    // Snapshot events cover only the last completed tick; the command at
    // tick 1 applies during the second step, so snapshot right after it.
    const world = makeWorld(['########', '........'], [{ x: 1, y: 1 }]);
    world.sim.submit(move(world.handles, 99, 99));
    run(world, 2);
    expect(rejections(world)).toContain('invalid_target');

    const world2 = makeWorld(['########', '........'], [{ x: 1, y: 1 }]);
    // Impassable cell for the unit's class.
    world2.sim.submit(move(world2.handles, 0, 0));
    run(world2, 2);
    expect(rejections(world2)).toContain('invalid_target');

    // Handles owned by a different issuer are skipped -> no_units.
    const world3 = makeWorld(['........'], [{ x: 1, y: 0, faction: 2 }]);
    world3.sim.submit(move(world3.handles, 5, 0, 1, F1));
    run(world3, 2);
    expect(rejections(world3)).toContain('no_units');
  });

  it('releases the shared goal on arrival (refcount back to 0)', () => {
    const world = makeWorld(
      ['................'],
      [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
      ],
    );
    world.sim.submit(move(world.handles, 10, 0));
    run(world, 10);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(2);
    run(world, 300);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('two move commands in one tick do not leak the first goal', () => {
    const world = makeWorld(['........................'], [{ x: 2, y: 0 }]);
    world.sim.submit(move(world.handles, 20, 0));
    world.sim.submit(move(world.handles, 6, 0));
    run(world, 3);
    expect(world.goals.length).toBe(2);
    // The first goal was released when the second command applied (its freed
    // id may immediately be reused for the new goal).
    expect(world.released).toEqual([world.goals[0]]);
    expect(world.pathingApi.goalRefCount(world.goals[1] ?? -1)).toBe(1);
    run(world, 300);
    const p = world.pos(0);
    // The unit ends at the second target.
    expect(Math.abs(p.x - 6.5)).toBeLessThan(1.0);
    expect(world.pathingApi.goalRefCount(world.goals[1] ?? -1)).toBe(0);
  });

  it('a crowd ordered against a wall and a cliff stays on legal cells', () => {
    // 60 units converge on a cell next to a rock blob; separation pushes are
    // routed through integrate, so nobody may end up in rock or off a cliff.
    // The makeWorld check system throws on any violation every tick.
    const rows = [
      '........................',
      '........................',
      '......####..............',
      '......####....222222....',
      '......####....222222....',
      '......####....222222....',
      '......####....222222....',
      '................rr2.....',
      '........................',
      '........................',
      '........................',
      '........................',
    ];
    const units: SpawnUnit[] = [];
    for (let i = 0; i < 60; i++) {
      units.push({ x: 1 + (i % 10), y: 8 + Math.floor(i / 10) });
    }
    const world = makeWorld(rows, units);
    world.sim.submit(move(world.handles, 7, 4));
    run(world, 900);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);

    // Second crowd: plateau edge. Target on the plateau next to the cliff;
    // units spawn below and must climb via the ramp, never across the edge.
    const units2: SpawnUnit[] = [];
    for (let i = 0; i < 60; i++) {
      units2.push({ x: 14 + (i % 8), y: 9 + Math.floor(i / 8) });
    }
    const world2 = makeWorld(rows, units2);
    world2.sim.submit(move(world2.handles, 18, 5));
    run(world2, 900);
    expect(world2.pathingApi.goalRefCount(world2.goals.at(-1) ?? -1)).toBe(0);
  });
});
