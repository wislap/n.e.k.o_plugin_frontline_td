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

    const world2 = makeWorld(
      ['########', '########', '########', '########', '........'],
      [{ x: 1, y: 4 }],
    );
    // Deep impassable cell beyond the <= 3-cell near-face snap radius.
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
      '........................',
      '........................',
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

  it('zero post-arrival interior crowd jitter after settling', () => {
    const rows = Array.from({ length: 24 }, () => '.'.repeat(24));
    const units: SpawnUnit[] = [];
    for (let i = 0; i < 36; i++) {
      units.push({ x: 2 + (i % 6), y: 2 + Math.floor(i / 6), radius: 0.35 });
    }
    const world = makeWorld(rows, units);
    world.sim.submit(move(world.handles, 14, 14));
    run(world, 600);
    for (let i = 0; i < 36; i++) {
      expect(world.active(i)).toBe(2);
      expect(world.vel(i)).toEqual({ x: 0, y: 0 });
    }
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);

    const prev = Array.from({ length: 36 }, (_, i) => world.pos(i));
    let maxDelta = 0;
    for (let t = 0; t < 20; t++) {
      world.sim.step();
      for (let i = 0; i < 36; i++) {
        const cur = world.pos(i);
        const p = prev[i] ?? { x: cur.x, y: cur.y };
        maxDelta = Math.max(maxDelta, Math.abs(cur.x - p.x), Math.abs(cur.y - p.y));
        prev[i] = cur;
      }
    }
    expect(maxDelta).toBe(0);
  });

  it('asymmetric r^2 * state yielding: heavy mover parts holding lights', () => {
    const rows = Array.from({ length: 7 }, () => '.'.repeat(16));
    const world = makeWorld(rows, [
      { x: 5, y: 2, radius: 0.35 },
      { x: 5, y: 3, radius: 0.35 },
      { x: 1, y: 2, radius: 0.8 },
    ]);
    // Settle both light units into active === 2 (holding) at (5,2) and (5,3).
    world.sim.submit(move([world.handles[0] ?? (0 as EntityHandle)], 5, 2));
    world.sim.submit(move([world.handles[1] ?? (0 as EntityHandle)], 5, 3));
    run(world, 10);
    expect(world.active(0)).toBe(2);
    expect(world.active(1)).toBe(2);

    // Order the heavy unit straight through (5,2) to (11,2).
    world.sim.submit(move([world.handles[2] ?? (0 as EntityHandle)], 11, 2, 11));
    run(world, 250);

    const heavyPos = world.pos(2);
    expect(world.active(2)).toBe(2);
    expect(heavyPos.x).toBeGreaterThan(11);
    expect(Math.abs(heavyPos.x - 12)).toBeLessThan(0.3);
    expect(Math.abs(heavyPos.y - 3)).toBeLessThan(0.3);

    // Light holders returned cleanly to hold near their assigned slots.
    expect(world.active(0)).toBe(2);
    expect(world.active(1)).toBe(2);
    expect(Math.abs(world.pos(0).x - 5.5)).toBeLessThan(0.4);
    expect(Math.abs(world.pos(0).y - 2.5)).toBeLessThan(0.4);
    expect(Math.abs(world.pos(1).x - 5.5)).toBeLessThan(0.4);
    expect(Math.abs(world.pos(1).y - 3.5)).toBeLessThan(0.4);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('asymmetric r^2 * state yielding: rear mover wraps around stopped frontline ally', () => {
    const rows = Array.from({ length: 7 }, () => '.'.repeat(12));
    const world = makeWorld(rows, [
      { x: 5, y: 3, radius: 0.35 },
      { x: 2, y: 3, radius: 0.35 },
    ]);
    expect(world.active(0)).toBe(0);
    world.sim.submit(move([world.handles[1] ?? (0 as EntityHandle)], 8, 3));
    run(world, 200);

    const p1 = world.pos(1);
    expect(world.active(1)).toBe(2);
    expect(Math.abs(p1.x - 8.5)).toBeLessThan(0.25);
    expect(Math.abs(p1.y - 3.5)).toBeLessThan(0.25);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('wall and convex corner margin clamping keeps safe distance from rock boundaries', () => {
    const rows = [
      '............',
      '............',
      '............',
      '......#.....',
      '......#####.',
      '......#####.',
      '......#####.',
      '......#####.',
      '......#####.',
      '............',
    ];
    const margin = Math.min(0.35 * 0.75, 0.3);
    const world = makeWorld(rows, [{ x: 5, y: 6, radius: 0.35 }]);
    world.sim.submit(move(world.handles, 8, 2));

    let minWallGap = Infinity;
    let minCornerDist = Infinity;
    for (let t = 0; t < 200; t++) {
      world.sim.step();
      const p = world.pos(0);
      const cx = Math.floor(p.x);
      const cy = Math.floor(p.y);
      if (!world.terrain.passable(cx - 1, cy, 0)) {
        minWallGap = Math.min(minWallGap, p.x - cx);
        expect(p.x - cx).toBeGreaterThanOrEqual(margin - 1e-6);
      }
      if (!world.terrain.passable(cx + 1, cy, 0)) {
        minWallGap = Math.min(minWallGap, cx + 1 - p.x);
        expect(cx + 1 - p.x).toBeGreaterThanOrEqual(margin - 1e-6);
      }
      if (!world.terrain.passable(cx, cy - 1, 0)) {
        minWallGap = Math.min(minWallGap, p.y - cy);
        expect(p.y - cy).toBeGreaterThanOrEqual(margin - 1e-6);
      }
      if (!world.terrain.passable(cx, cy + 1, 0)) {
        minWallGap = Math.min(minWallGap, cy + 1 - p.y);
        expect(cy + 1 - p.y).toBeGreaterThanOrEqual(margin - 1e-6);
      }
      // Check convex rock corners (including (6,3), (7,3), and (6,4)).
      for (const [vx, vy] of [
        [6, 3],
        [7, 3],
        [6, 4],
      ] as const) {
        const dx = p.x - vx;
        const dy = p.y - vy;
        const d = Math.sqrt(dx * dx + dy * dy);
        minCornerDist = Math.min(minCornerDist, d);
        expect(d).toBeGreaterThanOrEqual(margin - 1e-6);
      }
    }
    const end = world.pos(0);
    expect(world.active(0)).toBe(2);
    expect(Math.abs(end.x - 8.5)).toBeLessThan(0.25);
    expect(Math.abs(end.y - 2.5)).toBeLessThan(0.25);
    expect(minWallGap).toBeLessThan(0.5);
    expect(minCornerDist).toBeLessThan(1.0);
  });

  it('heavy tier=1 (2x2) unit routes through a 2-cell corridor and avoids 1-cell gaps', () => {
    const rows = Array.from({ length: 10 }, (_, y) => {
      const line = '.'.repeat(20).split('');
      if (y !== 1 && y !== 6 && y !== 7) {
        line[10] = '#';
      }
      return line.join('');
    });
    const world = makeWorld(rows, [{ x: 2, y: 1, radius: 0.8 }]);
    world.sim.submit(move(world.handles, 14, 1));
    let minCrossY = Infinity;
    let maxCrossY = -Infinity;
    for (let t = 0; t < 400; t++) {
      world.sim.step();
      const p = world.pos(0);
      if (p.x >= 10 && p.x <= 12) {
        minCrossY = Math.min(minCrossY, p.y);
        maxCrossY = Math.max(maxCrossY, p.y);
      }
    }
    const p = world.pos(0);
    expect(minCrossY).toBeGreaterThanOrEqual(6);
    expect(maxCrossY).toBeLessThanOrEqual(8);
    expect(world.active(0)).toBe(2);
    expect(p.x).toBeGreaterThanOrEqual(14.5);
    expect(p.y).toBeGreaterThanOrEqual(1);
    expect(Math.abs(p.x - 15)).toBeLessThan(0.3);
    expect(Math.abs(p.y - 2)).toBeLessThan(0.3);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('snaps MoveCommand within <= 3 cells onto the near face of structures and obstacle edges', () => {
    const rows = Array.from({ length: 9 }, () => '.'.repeat(16));
    const world = makeWorld(rows, [{ x: 2, y: 4 }]);
    const structure: { x: number; y: number }[] = [];
    for (let y = 3; y <= 5; y++) {
      for (let x = 8; x <= 10; x++) {
        structure.push({ x, y });
      }
    }
    world.terrain.setBlocked(structure, true);
    // Target the centre of the blocked 3x3 structure (2 cells inside from west face).
    world.sim.submit(move(world.handles, 9, 4));
    run(world, 10);
    expect(rejections(world)).toEqual([]);
    run(world, 150);
    const p = world.pos(0);
    expect(world.active(0)).toBe(2);
    expect(p.x).toBeLessThan(8);
    expect(Math.abs(p.x - 7.5)).toBeLessThan(0.6);
    expect(Math.abs(p.y - 4.5)).toBeLessThan(0.8);
  });

  it('longitudinal rear-unit yielding prevents faster rear ally from shoving slower front ally in a 1-wide corridor', () => {
    const rows = ['#'.repeat(24), '.'.repeat(24), '#'.repeat(24)];
    const world = makeWorld(rows, [
      { x: 5, y: 1, radius: 0.35, speed: 0.07 },
      { x: 2, y: 1, radius: 0.35, speed: 0.14 },
    ]);
    world.sim.submit(move(world.handles, 20, 1));
    let maxFrontStep = 0;
    let prevFrontX = world.pos(0).x;
    for (let t = 0; t < 120; t++) {
      world.sim.step();
      const curFrontX = world.pos(0).x;
      maxFrontStep = Math.max(maxFrontStep, curFrontX - prevFrontX);
      prevFrontX = curFrontX;
      expect(world.vel(0).x).toBeGreaterThanOrEqual(-1e-4);
      expect(world.vel(1).x).toBeGreaterThanOrEqual(-1e-4);
    }
    expect(maxFrontStep).toBeLessThanOrEqual(0.07 + 0.025);
    const steadyStart = world.pos(0).x;
    run(world, 20);
    const steadyPerTick = (world.pos(0).x - steadyStart) / 20;
    expect(steadyPerTick).toBeLessThan(0.09);
  });
});
