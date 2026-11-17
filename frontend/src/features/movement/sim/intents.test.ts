// Movement intents (A1): the move/stop intents resolve at the start of
// the movement phase in emission order, share applyMove with the
// command, and release/acquire shared goals exactly once per unit.
import { describe, expect, it } from 'vitest';
import type { Serializable } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import { makeWorld, move, run } from './test-world';
import { MoveIntent, StopIntent } from '../protocol';

// A command-phase system emitting the queued intents each tick; the
// movement resolver applies them in order during the same tick.
function emitter(queue: { def: never; payload: Serializable }[]): SimModule {
  return {
    id: 'frontline_td:test.emitter',
    install(builder) {
      builder.system({
        id: 'frontline_td:test.emitter',
        phase: 'command',
        emits: [MoveIntent, StopIntent],
        run(ctx) {
          for (const item of queue.splice(0)) {
            ctx.emit(item.def, item.payload);
          }
        },
      });
    },
  };
}

function build(rows: string[], units: { x: number; y: number }[]) {
  const queue: { def: never; payload: Serializable }[] = [];
  const world = makeWorld(rows, units, [emitter(queue)]);
  const emit = (def: never, payload: Serializable) => queue.push({ def, payload });
  return { world, emit };
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

  it('skips dead handles and non-movers without throwing', () => {
    const { world, emit } = build(ROWS, [{ x: 2, y: 0 }]);
    emit(MoveIntent as never, { units: [0, Number(world.handles[0])], x: 8, y: 0 });
    emit(StopIntent as never, { units: [0, 999999] });
    run(world, 1);
    expect(world.active(0)).toBe(1);
  });
});
