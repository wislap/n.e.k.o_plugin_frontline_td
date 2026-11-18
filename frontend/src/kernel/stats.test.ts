// Stat/modifier pipeline (A2): stacking, clamping, rounding, ordering,
// despawn cleanup, save/restore, and single-writer enforcement.
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../core/index';
import { toFactionId } from '../core/index';
import { createSimulation, restoreSimulation } from './simulation';
import type { SimModule, SpawnInit } from './types';
import { Faction, InWorld } from './contracts';
import { defineModifier, defineStat } from './stats';
import { baseConfig, F1 } from './testing/helpers';

const SpeedStat = defineStat('frontline_td:test.stat.speed');
const GeomStat = defineStat('frontline_td:test.stat.geom');
const AddA = defineModifier('frontline_td:test.stat.add_a', SpeedStat, 'add');
const AddB = defineModifier('frontline_td:test.stat.add_b', SpeedStat, 'add');
const MulA = defineModifier('frontline_td:test.stat.mul_a', SpeedStat, 'mul_bp');
const MulB = defineModifier('frontline_td:test.stat.mul_b', SpeedStat, 'mul_bp');
const MulGeom = defineModifier('frontline_td:test.stat.mul_geom', GeomStat, 'mul_bp');

// Spawns one entity per entry of `inits` (each is a spawn-init tail appended
// to Faction+InWorld) and exposes probes reading ctx.stat / modifiersOf.
function statModule(inits: readonly SpawnInit[], handles: (EntityHandle | null)[]): SimModule {
  return {
    id: 'frontline_td:test.stat',
    install(builder) {
      builder.onStart((ctx) => {
        inits.forEach((init, index) => {
          handles[index] = ctx.spawn([[Faction, { id: 1 }], [InWorld], ...init]);
        });
      });
      inits.forEach((_, index) => {
        builder.probe(`frontline_td:test.stat.q${index}`, (ctx) => {
          const id = ctx.resolve(handles[index] ?? (0 as EntityHandle));
          return id === null ? -1 : ctx.stat(SpeedStat, id, 100);
        });
        builder.probe(`frontline_td:test.stat.g${index}`, (ctx) => {
          const id = ctx.resolve(handles[index] ?? (0 as EntityHandle));
          return id === null ? -1 : ctx.stat(GeomStat, id, 2);
        });
      });
    },
  };
}

function makeSim(modules: SimModule[]) {
  return createSimulation(
    baseConfig({ factions: [{ id: F1 }, { id: toFactionId(2) }], rngStreams: [] }),
    modules,
  );
}

describe('stats & modifiers', () => {
  it('stacks adds then applies the summed mul_bp multiplier', () => {
    const handles: (EntityHandle | null)[] = [];
    const sim = makeSim([
      statModule(
        [
          [
            [AddA, { value: 30 }],
            [AddB, { value: 20 }],
            [MulA, { value: 2500 }],
            [MulB, { value: -500 }],
          ],
        ],
        handles,
      ),
    ]);
    sim.step();
    // (100 + 50) * (10000 + 2000) / 10000 = 180
    expect(sim.probes()['frontline_td:test.stat.q0']).toBe(180);
  });

  it('returns the base value for an entity with no modifiers', () => {
    const handles: (EntityHandle | null)[] = [];
    const sim = makeSim([statModule([[]], handles)]);
    sim.step();
    expect(sim.probes()['frontline_td:test.stat.q0']).toBe(100);
  });

  it('clamps the multiplier at -100%', () => {
    const handles: (EntityHandle | null)[] = [];
    const sim = makeSim([statModule([[[MulA, { value: -20000 }]]], handles)]);
    sim.step();
    expect(sim.probes()['frontline_td:test.stat.q0']).toBe(0);
  });

  it('keeps stat values fractional', () => {
    const handles: (EntityHandle | null)[] = [];
    const sim = makeSim([
      statModule(
        [
          [
            [MulGeom, { value: 3333 }],
            [MulA, { value: 5000 }],
          ],
        ],
        handles,
      ),
    ]);
    sim.step();
    // 100 * 1.5 = 150 (exact); 2 * 1.3333 = 2.6666 (fractional, not floored)
    expect(sim.probes()['frontline_td:test.stat.q0']).toBe(150);
    expect(sim.probes()['frontline_td:test.stat.g0']).toBeCloseTo(2.6666, 4);
  });

  it('negative adds lower the stat', () => {
    const handles: (EntityHandle | null)[] = [];
    const sim = makeSim([statModule([[[AddA, { value: -150 }]]], handles)]);
    sim.step();
    expect(sim.probes()['frontline_td:test.stat.q0']).toBe(-50);
  });

  it('modifiersOf lists active sources sorted by (stat id, source id)', () => {
    const handles: (EntityHandle | null)[] = [];
    const sim = makeSim([
      statModule(
        [
          [
            [MulGeom, { value: 100 }],
            [AddB, { value: 7 }],
            [AddA, { value: 5 }],
          ],
        ],
        handles,
      ),
    ]);
    sim.step();
    const inspection = sim.inspect(F1, handles[0] ?? (0 as EntityHandle));
    expect(inspection?.modifiers).toEqual([
      { stat: GeomStat.id, source: MulGeom.id, op: 'mul_bp', value: 100 },
      { stat: SpeedStat.id, source: AddA.id, op: 'add', value: 5 },
      { stat: SpeedStat.id, source: AddB.id, op: 'add', value: 7 },
    ]);
  });

  it('despawn removes modifiers: a recycled id starts clean', () => {
    const handles: (EntityHandle | null)[] = [];
    let spawned: EntityHandle | null = null;
    const churn: SimModule = {
      id: 'frontline_td:test.stat.churn',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.stat.churn.sys',
          phase: 'resolve',
          run(ctx) {
            if (ctx.tick === 1) {
              ctx.despawn(handles[0] ?? (0 as EntityHandle));
            }
            if (ctx.tick === 2) {
              spawned = ctx.spawn([[Faction, { id: 1 }], [InWorld]]);
            }
          },
        });
        builder.probe('frontline_td:test.stat.spawned', (ctx) => {
          const id = ctx.resolve(spawned ?? (0 as EntityHandle));
          return id === null ? -1 : ctx.stat(SpeedStat, id, 100);
        });
      },
    };
    const sim = makeSim([statModule([[[MulA, { value: 5000 }]]], handles), churn]);
    sim.step();
    sim.step();
    sim.step();
    expect(sim.probes()['frontline_td:test.stat.spawned']).toBe(100);
  });

  it('save/restore round-trips modifier state', () => {
    const handles: (EntityHandle | null)[] = [];
    const mods = () => [
      statModule(
        [
          [
            [AddA, { value: 40 }],
            [MulA, { value: 1000 }],
          ],
        ],
        handles,
      ),
    ];
    const sim = makeSim(mods());
    sim.step();
    sim.step();
    const saved = sim.serialize();
    sim.step();
    const restored = restoreSimulation(
      baseConfig({ factions: [{ id: F1 }, { id: toFactionId(2) }], rngStreams: [] }),
      mods(),
      saved,
    );
    restored.step();
    expect(restored.probes()['frontline_td:test.stat.q0']).toBe(
      sim.probes()['frontline_td:test.stat.q0'],
    );
    expect(restored.inspect(F1, handles[0] ?? (0 as EntityHandle))?.modifiers).toEqual(
      sim.inspect(F1, handles[0] ?? (0 as EntityHandle))?.modifiers,
    );
  });

  it('enforces a single writer per modifier component', () => {
    const claimer = (moduleId: string): SimModule => ({
      id: moduleId,
      install(builder) {
        builder.claimWriter(MulA);
      },
    });
    expect(() =>
      makeSim([claimer('frontline_td:test.stat.w1'), claimer('frontline_td:test.stat.w2')]),
    ).toThrow(/already has writer/);
  });
});
