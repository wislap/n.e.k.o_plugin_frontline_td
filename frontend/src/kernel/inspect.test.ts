// Inspectors + Simulation.inspect (A3): sections, owner check, read-only
// enforcement, and no effect on sim state or hash.
import { describe, expect, it } from 'vitest';
import { defineEvent } from '../core/index';
import { defineComponent } from './components';
import type { EntityHandle } from '../core/index';
import { NULL_HANDLE } from '../core/index';
import { createSimulation } from './simulation';
import type { SimModule } from './types';
import { Faction, InWorld } from './contracts';
import { baseConfig, F1, F2 } from './testing/helpers';

const Health = defineComponent('frontline_td:test.inspect.hp', { hp: 'i32' });
const Pinged = defineEvent('frontline_td:test.inspect.ping', 'all');

describe('Simulation.inspect', () => {
  it('collects non-null sections for an owned entity', () => {
    const handles: EntityHandle[] = [];
    const module: SimModule = {
      id: 'frontline_td:test.inspect',
      install(builder) {
        builder.onStart((ctx) => {
          handles.push(
            ctx.spawn([[Faction, { id: 1 }], [InWorld], [Health, { hp: 80 }]]),
            ctx.spawn([[Faction, { id: 2 }], [InWorld], [Health, { hp: 50 }]]),
          );
        });
        builder.inspector('frontline_td:test.inspect.hp', (ctx, entity) => ({
          hp: ctx.read(Health).hp[entity] ?? 0,
        }));
        builder.inspector('frontline_td:test.inspect.empty', () => null);
      },
    };
    const sim = createSimulation(
      baseConfig({ factions: [{ id: F1 }, { id: F2 }], rngStreams: [] }),
      [module],
    );
    sim.step();
    const inspection = sim.inspect(F1, handles[0] ?? NULL_HANDLE);
    expect(inspection).not.toBeNull();
    expect(inspection?.handle).toBe(handles[0]);
    expect(inspection?.sections).toEqual({
      'frontline_td:test.inspect.hp': { hp: 80 },
    });
    expect(inspection?.modifiers).toEqual([]);
  });

  it('returns null for invalid or non-owned handles', () => {
    const handles: EntityHandle[] = [];
    const module: SimModule = {
      id: 'frontline_td:test.inspect',
      install(builder) {
        builder.onStart((ctx) => {
          handles.push(
            ctx.spawn([[Faction, { id: 1 }], [InWorld]]),
            ctx.spawn([[Faction, { id: 2 }], [InWorld]]),
          );
        });
        builder.inspector('frontline_td:test.inspect.any', () => ({ seen: 1 }));
      },
    };
    const sim = createSimulation(
      baseConfig({ factions: [{ id: F1 }, { id: F2 }], rngStreams: [] }),
      [module],
    );
    sim.step();
    expect(sim.inspect(F1, NULL_HANDLE)).toBeNull();
    // handle[1] belongs to faction 2.
    expect(sim.inspect(F1, handles[1] ?? NULL_HANDLE)).toBeNull();
    expect(sim.inspect(F2, handles[1] ?? NULL_HANDLE)).not.toBeNull();
  });

  it('runs inspector callbacks read-only', () => {
    const captured: EntityHandle[] = [];
    const module: SimModule = {
      id: 'frontline_td:test.inspect',
      install(builder) {
        const healthWriter = builder.claimWriter(Health);
        builder.onStart((ctx) => {
          captured.push(ctx.spawn([[Faction, { id: 1 }], [InWorld], [Health, { hp: 1 }]]));
        });
        builder.inspector('frontline_td:test.inspect.evil', (ctx) => {
          const target = captured[0] ?? NULL_HANDLE;
          expect(() => {
            ctx.spawn([[InWorld]]);
          }).toThrow(/inspector/);
          expect(() => {
            ctx.despawn(target);
          }).toThrow(/inspector/);
          expect(() => {
            ctx.write(healthWriter);
          }).toThrow(/inspector/);
          expect(() => {
            ctx.addComponent(healthWriter, target, { hp: 2 });
          }).toThrow(/inspector/);
          expect(() => {
            ctx.removeComponent(healthWriter, target);
          }).toThrow(/inspector/);
          expect(() => {
            ctx.emit(Pinged, { n: 1 });
          }).toThrow(/inspector/);
          expect(() => {
            ctx.schedule('frontline_td:test.inspect.fx', 1, null, []);
          }).toThrow(/inspector/);
          expect(() => {
            ctx.reject('x');
          }).toThrow(/inspector/);
          return { ok: 1 };
        });
      },
    };
    const sim = createSimulation(baseConfig({ rngStreams: [] }), [module]);
    sim.step();
    const inspection = sim.inspect(F1, captured[0] ?? NULL_HANDLE);
    expect(inspection?.sections['frontline_td:test.inspect.evil']).toEqual({ ok: 1 });
  });

  it('does not advance or mutate the sim', () => {
    const captured: EntityHandle[] = [];
    const module: SimModule = {
      id: 'frontline_td:test.inspect',
      install(builder) {
        builder.onStart((ctx) => {
          captured.push(ctx.spawn([[Faction, { id: 1 }], [InWorld]]));
        });
        builder.inspector('frontline_td:test.inspect.tick', (ctx) => ({ tick: ctx.tick }));
      },
    };
    const sim = createSimulation(baseConfig({ rngStreams: [] }), [module]);
    sim.step();
    const hashBefore = sim.hash();
    const tickBefore = sim.tick;
    sim.inspect(F1, captured[0] ?? NULL_HANDLE);
    expect(sim.hash()).toBe(hashBefore);
    expect(sim.tick).toBe(tickBefore);
  });
});
