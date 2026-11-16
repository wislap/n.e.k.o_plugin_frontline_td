import { describe, expect, it } from 'vitest';
import { createSimulation } from './simulation';
import { defineComponent } from './components';
import { defineEvent } from '../core/index';
import { defineGridLayer } from './layers';
import type { SimModule } from './types';
import { baseConfig, F1 } from './testing/helpers';
import { EXERCISE_RNG } from './testing/exercise';

const OnStartMarker = defineComponent('frontline_td:test.onstart.marker', { v: 'i32' });
const TestEventA = defineEvent<{ n: number }>('frontline_td:test.onstart.ev', 'all');

const Fog = defineGridLayer('frontline_td:test.fog', 'u8', { perFaction: true });

describe('kernel misc', () => {
  it('snapshots expose all observer-visible layers plus a changedLayers list', () => {
    const mod: SimModule = {
      id: 'frontline_td:test.layers',
      install(builder) {
        const fog = builder.claimLayerWriter(Fog);
        builder.system({
          id: 'frontline_td:test.fogwriter',
          phase: 'capture_fog',
          run(ctx) {
            if (ctx.tick === 0) {
              const layer = ctx.writeLayer(fog, F1);
              layer[0] = 7;
            }
          },
        });
      },
    };
    const sim = createSimulation(baseConfig(), [mod]);
    sim.step();
    const first = sim.snapshot(F1);
    // Full observer view: the per-faction layer is always present (read-only
    // reference); changedLayers carries the delta information.
    expect(Object.keys(first.layers)).toEqual(['frontline_td:test.fog#1']);
    expect(first.layers['frontline_td:test.fog#1']?.[0]).toBe(7);
    expect(first.changedLayers).toEqual(['frontline_td:test.fog#1']);
    expect(sim.changedLayers()).toEqual(first.changedLayers);
    sim.step();
    const second = sim.snapshot(F1);
    expect(Object.keys(second.layers)).toEqual(['frontline_td:test.fog#1']);
    expect(second.changedLayers).toEqual([]);
  });

  it('defineGridLayer rejects a duplicate id with different shape', () => {
    expect(() => defineGridLayer('frontline_td:test.fog', 'i32', { perFaction: true })).toThrow(
      /already defined/,
    );
    expect(() => defineGridLayer('frontline_td:test.fog', 'u8', { perFaction: false })).toThrow(
      /already defined/,
    );
    // Identical redefinition is allowed (static module-level defs).
    expect(() =>
      defineGridLayer('frontline_td:test.fog', 'u8', { perFaction: true }),
    ).not.toThrow();
  });

  it('system registration validates everyTicks and offset', () => {
    const mod = (spec: { everyTicks?: number; offset?: number }): SimModule => ({
      id: 'frontline_td:test.throttle2',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.throttle2.sys',
          phase: 'orders',
          ...spec,
          run() {},
        });
      },
    });
    expect(() => createSimulation(baseConfig(), [mod({ everyTicks: 0 })])).toThrow(/everyTicks/);
    expect(() => createSimulation(baseConfig(), [mod({ everyTicks: 1.5 })])).toThrow(/everyTicks/);
    expect(() => createSimulation(baseConfig(), [mod({ everyTicks: 3, offset: 3 })])).toThrow(
      /offset/,
    );
    expect(() => createSimulation(baseConfig(), [mod({ everyTicks: 3, offset: -1 })])).toThrow(
      /offset/,
    );
  });

  it('ctx.rng throws for undeclared streams', () => {
    const mod: SimModule = {
      id: 'frontline_td:test.rngr',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.rngr.sys',
          phase: 'orders',
          run(ctx) {
            ctx.rng('frontline_td:undeclared');
          },
        });
      },
    };
    const sim = createSimulation(baseConfig(), [mod]);
    expect(() => {
      sim.step();
    }).toThrow(/undeclared rng stream/);
  });

  it('declared rng streams are reachable and deterministic', () => {
    const draws: number[] = [];
    const mod: SimModule = {
      id: 'frontline_td:test.rngr2',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.rngr2.sys',
          phase: 'orders',
          run(ctx) {
            draws.push(ctx.rng(EXERCISE_RNG)[0] ?? 0);
          },
        });
      },
    };
    const a = createSimulation(baseConfig(), [mod]);
    a.step();
    draws.splice(0);
    const b = createSimulation(baseConfig(), [mod]);
    b.step();
    expect(draws).toHaveLength(1);
  });

  it('everyTicks/offset throttle system runs', () => {
    const runs: number[] = [];
    const mod: SimModule = {
      id: 'frontline_td:test.throttle',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.throttle.sys',
          phase: 'orders',
          everyTicks: 3,
          offset: 1,
          run(ctx) {
            runs.push(ctx.tick);
          },
        });
      },
    };
    const sim = createSimulation(baseConfig(), [mod]);
    for (let t = 0; t < 8; t++) {
      sim.step();
    }
    expect(runs).toEqual([1, 4, 7]);
  });

  it('zero modules: 100 deterministic ticks with built-in probes', () => {
    const make = () => createSimulation(baseConfig({ controllers: [] }), []);
    const a = make();
    const b = make();
    for (let t = 0; t < 100; t++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
    expect(a.probes()['frontline_td:kernel.tick']).toBe(100);
    expect(a.probes()['frontline_td:kernel.entities']).toBe(0);
  });

  it('onStart hooks run in order, can spawn, and forbid emit/read/schedule', () => {
    const Marker = OnStartMarker;
    const order: number[] = [];
    const modA: SimModule = {
      id: 'frontline_td:test.onstart.a',
      install(builder) {
        builder.onStart((ctx) => {
          order.push(1);
          ctx.spawn([[Marker, { v: 1 }]]);
          expect(() => {
            ctx.emit(TestEventA, { n: 1 });
          }).toThrow(/onStart/);
          expect(() => {
            ctx.schedule('frontline_td:test.noeffect', 1, {}, []);
          }).toThrow(/onStart/);
        });
      },
    };
    const modB: SimModule = {
      id: 'frontline_td:test.onstart.b',
      install(builder) {
        builder.onStart(() => {
          order.push(2);
        });
      },
    };
    const sim = createSimulation(baseConfig(), [modA, modB]);
    expect(order).toEqual([1, 2]);
    // The spawn queued inside onStart was applied before tick 0.
    expect(sim.probes()['frontline_td:kernel.entities']).toBe(1);
  });
});
