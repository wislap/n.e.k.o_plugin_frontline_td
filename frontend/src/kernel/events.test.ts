import { describe, expect, it } from 'vitest';
import { defineEvent, defineIntent } from '../core/index';
import { createSimulation } from './simulation';
import type { SimModule } from './types';
import { baseConfig } from './testing/helpers';

type Ping = { n: number };
const Ping = defineEvent<Ping>('frontline_td:test.ping', 'all');
const Nudge = defineIntent<Ping>('frontline_td:test.nudge');

function moduleWith(install: SimModule['install']): SimModule {
  return { id: 'frontline_td:test.events', install };
}

describe('kernel events and intents', () => {
  it('same-phase readers do not see events emitted in that phase', () => {
    const seen: number[] = [];
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.emitter',
        phase: 'orders',
        emits: [Ping],
        run(ctx) {
          ctx.emit(Ping, { n: 1 });
        },
      });
      builder.system({
        id: 'frontline_td:test.same_phase_reader',
        phase: 'orders',
        reads: [Ping],
        run(ctx) {
          seen.push(ctx.read(Ping).length);
        },
      });
      builder.system({
        id: 'frontline_td:test.later_phase_reader',
        phase: 'resolve',
        reads: [Ping],
        run(ctx) {
          seen.push(ctx.read(Ping).length);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    sim.step();
    // same-phase reader sees nothing; resolve-phase reader sees the event.
    expect(seen).toEqual([0, 1]);
  });

  it('a throttled reader accumulates all events since its last run', () => {
    const totals: number[] = [];
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.emitter2',
        phase: 'orders',
        emits: [Ping],
        run(ctx) {
          ctx.emit(Ping, { n: 1 });
        },
      });
      builder.system({
        id: 'frontline_td:test.throttled',
        phase: 'resolve',
        everyTicks: 3,
        offset: 0,
        reads: [Ping],
        run(ctx) {
          totals.push(ctx.read(Ping).length);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    for (let t = 0; t < 6; t++) {
      sim.step();
    }
    // Runs at ticks 0 and 3: first consumes 1 event, second consumes the
    // 3 emitted during ticks 1..3.
    expect(totals).toEqual([1, 3]);
  });

  it('reader cursor advances: a second read in a later phase sees only new entries', () => {
    const sizes: number[] = [];
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.emitter3',
        phase: 'orders',
        emits: [Ping],
        run(ctx) {
          ctx.emit(Ping, { n: ctx.tick });
        },
      });
      builder.system({
        id: 'frontline_td:test.reader',
        phase: 'resolve',
        reads: [Ping],
        run(ctx) {
          sizes.push(ctx.read(Ping).length);
          sizes.push(ctx.read(Ping).length);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    sim.step();
    expect(sizes).toEqual([1, 0]);
  });

  it('reads must be declared: an undeclared channel read throws', () => {
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.sneaky',
        phase: 'orders',
        run(ctx) {
          ctx.read(Ping);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    expect(() => {
      sim.step();
    }).toThrow(/reads/);
  });

  it('emits must be declared: an undeclared channel emit throws', () => {
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.sneaky_emit',
        phase: 'orders',
        run(ctx) {
          ctx.emit(Ping, { n: 1 });
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    expect(() => {
      sim.step();
    }).toThrow(/emits/);
  });

  it('two different def objects with the same type throw at install', () => {
    const DupA = defineEvent<Ping>('frontline_td:test.ping', 'all');
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.dup_emit',
        phase: 'orders',
        emits: [DupA],
        run(ctx) {
          ctx.emit(DupA, { n: 1 });
        },
      });
      builder.system({
        id: 'frontline_td:test.dup_reader',
        phase: 'resolve',
        reads: [Ping],
        run(ctx) {
          ctx.read(Ping);
        },
      });
    });
    expect(() => createSimulation(baseConfig(), [mod])).toThrow(/conflicting definitions/);
  });

  it('intents allow exactly one reader', () => {
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.r1',
        phase: 'orders',
        reads: [Nudge],
        run(ctx) {
          ctx.read(Nudge);
        },
      });
      builder.system({
        id: 'frontline_td:test.r2',
        phase: 'resolve',
        reads: [Nudge],
        run(ctx) {
          ctx.read(Nudge);
        },
      });
    });
    expect(() => createSimulation(baseConfig(), [mod])).toThrow(/exactly one reader/);
  });

  it('scheduled effects run in (dueTick, phase, seq) order and reject delay < 1', () => {
    const order: string[] = [];
    const mod = moduleWith((builder) => {
      builder.effect('frontline_td:test.fx_a', 'resolve', (ctx, params) => {
        order.push(`a:${(params as { k: number }).k}`);
      });
      builder.effect('frontline_td:test.fx_b', 'cleanup', (ctx, params) => {
        order.push(`b:${(params as { k: number }).k}`);
      });
      builder.system({
        id: 'frontline_td:test.scheduler',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            ctx.schedule('frontline_td:test.fx_b', 1, { k: 1 }, []);
            ctx.schedule('frontline_td:test.fx_a', 1, { k: 2 }, []);
            expect(() => {
              ctx.schedule('frontline_td:test.fx_a', 0, { k: 3 }, []);
            }).toThrow(RangeError);
          }
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    sim.step();
    sim.step();
    // resolve (index 5) runs before cleanup (index 6) in the same tick.
    expect(order).toEqual(['a:2', 'b:1']);
  });

  it('unregistered effect type throws on schedule', () => {
    const mod = moduleWith((builder) => {
      builder.system({
        id: 'frontline_td:test.scheduler2',
        phase: 'orders',
        run(ctx) {
          ctx.schedule('frontline_td:test.nope', 1, {}, []);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    expect(() => {
      sim.step();
    }).toThrow(/no effect handler/);
  });
});
