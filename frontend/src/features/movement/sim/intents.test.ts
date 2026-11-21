// Movement intents (A1): the move/stop intents resolve at the start of
// the movement phase in emission order, share applyMove with the
// command, and release/acquire shared goals exactly once per unit.
import { describe, expect, it } from 'vitest';
import type { EntityHandle, Serializable } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import { makeWorld, move, run } from './test-world';
import { FormationGuideIntent, MoveIntent, StopIntent } from '../protocol';
import { FormationGuide } from './components';

// A command-phase system emitting the queued intents each tick; the
// movement resolver applies them in order during the same tick.
function emitter(queue: { def: never; payload: Serializable }[]): SimModule {
  return {
    id: 'frontline_td:test.emitter',
    install(builder) {
      builder.system({
        id: 'frontline_td:test.emitter',
        phase: 'command',
        emits: [MoveIntent, StopIntent, FormationGuideIntent],
        run(ctx) {
          for (const item of queue.splice(0)) {
            ctx.emit(item.def, item.payload);
          }
        },
      });
    },
  };
}

function guideProbe(handles: () => readonly EntityHandle[], count: number): SimModule {
  return {
    id: 'frontline_td:test.guide_probe',
    install(builder) {
      for (let i = 0; i < count; i++) {
        builder.probe(`frontline_td:test.ga${i}`, (ctx) => {
          const id = ctx.resolve(handles()[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(FormationGuide).active[id] ?? -1);
        });
      }
    },
  };
}

function build(rows: string[], units: { x: number; y: number }[]) {
  const queue: { def: never; payload: Serializable }[] = [];
  const world = makeWorld(rows, units, [
    emitter(queue),
    guideProbe(() => world.handles, units.length),
  ]);
  const emit = (def: never, payload: Serializable) => queue.push({ def, payload });
  const guideActive = (i: number) => world.sim.probes()[`frontline_td:test.ga${i}`] ?? -1;
  return { world, emit, guideActive };
}

const ROWS = ['.' + '.'.repeat(15)];

describe('movement intents', () => {
  it('move intent produces the same goal/slot state as the command', () => {
    const a = build(ROWS, [{ x: 2, y: 0 }]);
    a.emit(MoveIntent as never, { units: [Number(a.world.handles[0])], x: 10, y: 0 });
    run(a.world, 1);
    const b = makeWorld(ROWS, [{ x: 2, y: 0 }]);
    b.sim.submit(move(b.handles, 10, 0));
    run(b, 2);
    expect(a.world.active(0)).toBe(1);
    expect(a.world.slot(0)).toEqual(b.slot(0));
    expect(a.world.pathingApi.goalRefCount(a.world.goals.at(-1) ?? -1)).toBe(1);
  });

  it('later move intents win within a tick (emission order)', () => {
    const { world, emit } = build(ROWS, [{ x: 2, y: 0 }]);
    const h = Number(world.handles[0]);
    emit(MoveIntent as never, { units: [h], x: 5, y: 0 });
    emit(MoveIntent as never, { units: [h], x: 12, y: 0 });
    run(world, 1);
    expect(Math.abs(world.slot(0).x - 12.5)).toBeLessThan(1);
    // Old goal released once, new goal held once.
    expect(world.released).toHaveLength(1);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(1);
  });

  it('stop intent releases the goal and deactivates the target', () => {
    const { world, emit } = build(ROWS, [{ x: 2, y: 0 }]);
    const h = Number(world.handles[0]);
    emit(MoveIntent as never, { units: [h], x: 10, y: 0 });
    run(world, 1);
    emit(StopIntent as never, { units: [h] });
    run(world, 1);
    expect(world.active(0)).toBe(0);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('a duplicated handle in one intent acquires its goal share once', () => {
    const { world, emit } = build(ROWS, [{ x: 2, y: 0 }]);
    const h = Number(world.handles[0]);
    emit(MoveIntent as never, { units: [h, h], x: 10, y: 0 });
    run(world, 1);
    expect(world.active(0)).toBe(1);
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(1);
  });

  it('skips dead handles and non-movers without throwing', () => {
    const { world, emit } = build(ROWS, [{ x: 2, y: 0 }]);
    emit(MoveIntent as never, { units: [0, Number(world.handles[0])], x: 8, y: 0 });
    emit(StopIntent as never, { units: [0, 999999] });
    run(world, 1);
    expect(world.active(0)).toBe(1);
  });

  it('MoveIntent.slots assigns explicit per-unit coordinates and falls back on invalid slots', () => {
    const grid = ['..#..', '.....', '.....', '.....'];
    const { world, emit } = build(grid, [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ]);
    const h0 = Number(world.handles[0]);
    const h1 = Number(world.handles[1]);
    emit(MoveIntent as never, {
      units: [h0, h1],
      x: 4,
      y: 1,
      slots: [
        { x: 3.25, y: 2.75 },
        { x: 1.5, y: 0.5 },
      ],
    });
    run(world, 1);
    expect(world.active(0)).toBe(1);
    expect(world.active(1)).toBe(1);
    expect(world.slot(0)).toEqual({ x: 3.25, y: 2.75 });
    expect(world.slot(1)).toEqual({ x: 1.5, y: 0.5 });
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(2);

    // Out-of-bounds and impassable slots fall back to target anchor centre,
    // while valid slots in the same MoveIntent retain their coordinates.
    emit(MoveIntent as never, {
      units: [h0, h1],
      x: 4,
      y: 2,
      slots: [
        { x: 2.5, y: 0.5 }, // impassable '#'
        { x: 99, y: 2 }, // out-of-bounds
      ],
    });
    run(world, 1);
    expect(world.slot(0)).toEqual({ x: 4.5, y: 2.5 });
    expect(world.slot(1)).toEqual({ x: 4.5, y: 2.5 });

    emit(MoveIntent as never, {
      units: [h0, h1],
      x: 4,
      y: 2,
      slots: [
        { x: 3.5, y: 3.5 },
        { x: 2.5, y: 0.5 }, // impassable '#'
      ],
    });
    run(world, 1);
    expect(world.slot(0)).toEqual({ x: 3.5, y: 3.5 });
    expect(world.slot(1)).toEqual({ x: 4.5, y: 2.5 });
  });

  it('FormationGuideIntent caps speed at <= statSpeed without overriding flow heading', () => {
    const grid = Array.from({ length: 5 }, () => '.'.repeat(20));
    const { world, emit, guideActive } = build(grid, [{ x: 1, y: 2 }]);
    const h0 = Number(world.handles[0]);
    emit(MoveIntent as never, { units: [h0], x: 18, y: 2 });
    emit(FormationGuideIntent as never, {
      units: [h0],
      maxSpeeds: [0.05],
      active: true,
    });
    run(world, 1);
    const v1 = world.vel(0);
    const s1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    expect(guideActive(0)).toBe(1);
    // Flows horizontally along y=2.5 without any 2D waypoint deflection.
    expect(v1.x).toBeGreaterThan(0.045);
    expect(Math.abs(v1.y)).toBeLessThan(0.01);
    expect(s1).toBeCloseTo(0.05, 6);

    // maxSpeed above statSpeed (0.125) never exceeds statSpeed.
    emit(FormationGuideIntent as never, {
      units: [h0],
      maxSpeeds: [0.5],
      active: true,
    });
    run(world, 1);
    const v2 = world.vel(0);
    const s2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    expect(s2).toBeCloseTo(0.125, 6);
  });

  it('clears FormationGuide and restores full speed on deactivate, StopIntent, MoveCommand, and arrival', () => {
    const grid = Array.from({ length: 5 }, () => '.'.repeat(20));

    // 1. FormationGuideIntent({ active: false }) restores full speed.
    const a = build(grid, [{ x: 1, y: 2 }]);
    const ha = Number(a.world.handles[0]);
    a.emit(MoveIntent as never, { units: [ha], x: 18, y: 2 });
    a.emit(FormationGuideIntent as never, {
      units: [ha],
      maxSpeeds: [0.05],
      active: true,
    });
    run(a.world, 1);
    expect(a.guideActive(0)).toBe(1);
    a.emit(FormationGuideIntent as never, { units: [ha], active: false });
    run(a.world, 1);
    expect(a.guideActive(0)).toBe(0);
    const va = a.world.vel(0);
    expect(Math.sqrt(va.x * va.x + va.y * va.y)).toBeCloseTo(0.125, 6);

    // 2. StopIntent clears the guide and stops the unit.
    const b = build(grid, [{ x: 1, y: 2 }]);
    const hb = Number(b.world.handles[0]);
    b.emit(MoveIntent as never, { units: [hb], x: 18, y: 2 });
    b.emit(FormationGuideIntent as never, {
      units: [hb],
      maxSpeeds: [0.05],
      active: true,
    });
    run(b.world, 1);
    expect(b.guideActive(0)).toBe(1);
    b.emit(StopIntent as never, { units: [hb] });
    run(b.world, 1);
    expect(b.world.active(0)).toBe(0);
    expect(b.guideActive(0)).toBe(0);
    expect(b.world.vel(0)).toEqual({ x: 0, y: 0 });

    // 3. Player MoveCommand clears the guide and restores full speed immediately.
    const c = build(grid, [{ x: 1, y: 2 }]);
    const hc = Number(c.world.handles[0]);
    c.emit(MoveIntent as never, { units: [hc], x: 18, y: 2 });
    c.emit(FormationGuideIntent as never, {
      units: [hc],
      maxSpeeds: [0.05],
      active: true,
    });
    run(c.world, 1);
    expect(c.guideActive(0)).toBe(1);
    c.world.sim.submit(move(c.world.handles, 18, 2, c.world.sim.tick + 1));
    run(c.world, 2);
    expect(c.guideActive(0)).toBe(0);
    const vc = c.world.vel(0);
    expect(Math.sqrt(vc.x * vc.x + vc.y * vc.y)).toBeCloseTo(0.125, 6);

    // 4. Arrival into holdUnit (active === 2) clears the guide.
    const d = build(grid, [{ x: 1, y: 2 }]);
    const hd = Number(d.world.handles[0]);
    d.emit(MoveIntent as never, { units: [hd], x: 2, y: 2 });
    d.emit(FormationGuideIntent as never, {
      units: [hd],
      maxSpeeds: [0.05],
      active: true,
    });
    run(d.world, 30);
    expect(d.world.active(0)).toBe(2);
    expect(d.guideActive(0)).toBe(0);
  });
});
