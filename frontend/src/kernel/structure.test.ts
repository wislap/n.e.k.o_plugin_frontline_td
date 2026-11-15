import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../core/index';
import { handleId } from '../core/index';
import { defineComponent } from './components';
import { createSimulation } from './simulation';
import type { SimModule, SystemContext } from './types';
import { baseConfig } from './testing/helpers';

const Pos = defineComponent('frontline_td:test.pos', { x: 'f64', y: 'f64' });
const Tag = defineComponent('frontline_td:test.tag', {});

// Captures what a system observes each tick so tests can assert it.
function recordingModule(
  id: string,
  install: (
    builder: Parameters<SimModule['install']>[0],
    record: { ctxs: SystemContext[]; queries: number[][] },
  ) => void,
): { module: SimModule; record: { ctxs: SystemContext[]; queries: number[][] } } {
  const record = { ctxs: [] as SystemContext[], queries: [] as number[][] };
  return {
    record,
    module: {
      id,
      install(builder) {
        install(builder, record);
      },
    },
  };
}

describe('kernel structure', () => {
  it('deferred apply: spawned entities are invisible until the tick ends', () => {
    const { module, record } = recordingModule('frontline_td:test.m1', (builder, r) => {
      builder.system({
        id: 'frontline_td:test.spawner',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            ctx.spawn([[Pos, { x: 1, y: 2 }]]);
          }
        },
      });
      builder.system({
        id: 'frontline_td:test.probe',
        phase: 'capture_fog',
        run(ctx) {
          r.queries.push([...ctx.query([Pos])]);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    sim.step();
    sim.step();
    expect(record.queries).toEqual([[], [1]]);
  });

  it('queries return ids sorted ascending after interleaved spawn/despawn', () => {
    const spawned: EntityHandle[] = [];
    const { module, record } = recordingModule('frontline_td:test.m2', (builder, r) => {
      builder.system({
        id: 'frontline_td:test.spawn2',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            for (let k = 0; k < 4; k++) {
              spawned.push(ctx.spawn([[Pos, { x: k, y: k }]]));
            }
          }
          if (ctx.tick === 1) {
            // Despawn ids 1 and 3, then spawn two more (which recycle ids).
            const second = spawned[1];
            const fourth = spawned[3];
            if (second !== undefined && fourth !== undefined) {
              ctx.despawn(second);
              ctx.despawn(fourth);
            }
            spawned.push(ctx.spawn([[Pos, { x: 9, y: 9 }]]));
            spawned.push(ctx.spawn([[Pos, { x: 8, y: 8 }]]));
          }
        },
      });
      builder.system({
        id: 'frontline_td:test.probe2',
        phase: 'capture_fog',
        run(ctx) {
          r.queries.push([...ctx.query([Pos])]);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    sim.step();
    sim.step();
    sim.step();
    const last = record.queries[record.queries.length - 1] ?? [];
    expect(last).toHaveLength(4);
    const sorted = [...last].sort((a, b) => a - b);
    expect(last).toEqual(sorted);
  });

  it('generation guards: a stale handle fails after despawn and id reuse', () => {
    let stale: EntityHandle | null = null;
    const valid: boolean[] = [];
    const { module } = recordingModule('frontline_td:test.m3', (builder) => {
      builder.system({
        id: 'frontline_td:test.spawn3',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            const first = ctx.spawn([[Tag]]);
            stale = first;
            ctx.despawn(first);
            ctx.spawn([[Tag]]); // recycles the id at apply time
          }
          if (ctx.tick === 1 && stale !== null) {
            valid.push(ctx.isValid(stale));
          }
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    sim.step();
    sim.step();
    expect(valid).toEqual([false]);
  });

  it('storage growth beyond initial capacity preserves existing data', () => {
    const { module, record } = recordingModule('frontline_td:test.m4', (builder, r) => {
      builder.system({
        id: 'frontline_td:test.spawn4',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick < 6) {
            ctx.spawn([[Pos, { x: ctx.tick * 100, y: ctx.tick }]]);
          }
        },
      });
      builder.system({
        id: 'frontline_td:test.probe4',
        phase: 'capture_fog',
        run(ctx) {
          r.ctxs.push(ctx);
        },
      });
    });
    const sim = createSimulation(baseConfig({ initialEntityCapacity: 2 }), [module]);
    for (let t = 0; t < 7; t++) {
      sim.step();
    }
    const ctx = record.ctxs[record.ctxs.length - 1];
    expect(ctx).toBeDefined();
    const view = ctx?.read(Pos);
    const ids = [...(ctx?.query([Pos]) ?? [])];
    expect(ids).toHaveLength(6);
    for (const id of ids) {
      expect(view?.x[id]).toBe((id - 1) * 100);
      expect(view?.y[id]).toBe(id - 1);
    }
  });

  it('single-writer rule: a second claim throws naming both claimants', () => {
    const a: SimModule = {
      id: 'frontline_td:test.a',
      install: (builder) => {
        builder.claimWriter(Pos);
      },
    };
    const b: SimModule = {
      id: 'frontline_td:test.b',
      install: (builder) => {
        builder.claimWriter(Pos);
      },
    };
    expect(() => createSimulation(baseConfig(), [a, b])).toThrow(
      /test\.a.*test\.b|test\.b.*test\.a/,
    );
  });

  it('pending spawn cancelled by same-tick despawn releases the id', () => {
    const { module, record } = recordingModule('frontline_td:test.m6', (builder, r) => {
      builder.system({
        id: 'frontline_td:test.spawn6',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            const h = ctx.spawn([[Pos, { x: 1, y: 1 }]]);
            ctx.despawn(h);
          }
          if (ctx.tick === 1) {
            r.queries.push([...ctx.query([Pos])]);
          }
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    sim.step();
    sim.step();
    expect(record.queries[0]).toEqual([]);
    expect(sim.probes()['frontline_td:kernel.entities']).toBe(0);
  });

  it('a cancelled spawn still bumps the generation: old handle dies with the recycled id', () => {
    let stale: EntityHandle | null = null;
    let staleId = 0;
    let recycled = 0;
    const valid: boolean[] = [];
    const { module } = recordingModule('frontline_td:test.m7', (builder) => {
      builder.system({
        id: 'frontline_td:test.spawn7',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            // Spawn and cancel in the same tick; the id is released at apply.
            stale = ctx.spawn([[Tag]]);
            staleId = handleId(stale);
            ctx.despawn(stale);
          }
          if (ctx.tick === 1 && stale !== null) {
            // This spawn completes normally and recycles the cancelled id.
            recycled = handleId(ctx.spawn([[Tag]]));
            valid.push(ctx.isValid(stale));
          }
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    sim.step();
    sim.step();
    expect(recycled).toBe(staleId);
    // Even though the id is alive again, the pre-spawn handle is dead.
    expect(valid).toEqual([false]);
  });

  it('component attach zeroes all fields before writing init values', () => {
    // A recycled id could carry stale field values; unspecified fields must
    // restart at zero so in-memory and restored runs agree.
    const seen: number[] = [];
    let recycledHandle: EntityHandle | null = null;
    const { module } = recordingModule('frontline_td:test.m8', (builder) => {
      const pos = builder.claimWriter(Pos);
      builder.system({
        id: 'frontline_td:test.spawn8',
        phase: 'orders',
        run(ctx) {
          if (ctx.tick === 0) {
            const h = ctx.spawn([[Pos, { x: 55, y: 66 }]]);
            ctx.despawn(h);
            // Recycles the id with only Tag; Pos is attached below via
            // addComponent, and spawn inits take the same zero-first path.
            recycledHandle = ctx.spawn([[Tag]]);
          }
          if (ctx.tick === 1 && recycledHandle !== null) {
            ctx.addComponent(pos, recycledHandle, { x: 7 });
          }
          if (ctx.tick === 2) {
            const view = ctx.read(Pos);
            for (const id of ctx.query([Pos])) {
              seen.push(view.x[id] ?? -1, view.y[id] ?? -1);
            }
          }
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    sim.step();
    sim.step();
    sim.step();
    expect(seen).toEqual([7, 0]);
  });

  it('allocation depends only on alive set + free list, not live order', () => {
    // Two runs reaching identical alive sets and free lists through different
    // spawn/despawn histories (hence different dense live order) must allocate
    // identical ids for the next spawns. This is the property that lets the
    // save omit live order.
    type Allocations = { canonical: string; next: number[] };
    const run = (variant: 'a' | 'b'): Allocations => {
      const handles: EntityHandle[] = [];
      const next: number[] = [];
      const mod: SimModule = {
        id: 'frontline_td:test.alloc',
        install(builder) {
          builder.system({
            id: 'frontline_td:test.alloc.sys',
            phase: 'orders',
            run(ctx) {
              if (ctx.tick === 0) {
                for (let k = 0; k < 6; k++) {
                  handles.push(ctx.spawn([[Tag]]));
                }
              }
              if (variant === 'a') {
                if (ctx.tick === 1) {
                  ctx.despawn(handles[1] as EntityHandle);
                  ctx.despawn(handles[3] as EntityHandle);
                }
              } else {
                // Same final removals but first churn the live order: despawn
                // id 1, respawn it (recycled ids land at the live end), then
                // despawn 2 and 4.
                if (ctx.tick === 1) {
                  ctx.despawn(handles[0] as EntityHandle);
                }
                if (ctx.tick === 2) {
                  handles.push(ctx.spawn([[Tag]]));
                }
                if (ctx.tick === 3) {
                  ctx.despawn(handles[1] as EntityHandle);
                  ctx.despawn(handles[3] as EntityHandle);
                }
              }
              if (ctx.tick === 4) {
                for (let k = 0; k < 4; k++) {
                  next.push(handleId(ctx.spawn([[Tag]])));
                }
              }
            },
          });
        },
      };
      const sim = createSimulation(baseConfig(), [mod]);
      for (let t = 0; t < 4; t++) {
        sim.step();
      }
      const saved = sim.serialize() as {
        entities: { maxId: number; alive: number[]; free: number[] };
      };
      sim.step();
      // Generations legitimately differ between the two histories; the claim
      // is only about future allocation.
      const { maxId, alive, free } = saved.entities;
      return { canonical: JSON.stringify({ maxId, alive, free }), next };
    };
    const a = run('a');
    const b = run('b');
    expect(a.canonical).toBe(b.canonical);
    expect(a.next).toEqual(b.next);
    expect(a.next.length).toBeGreaterThan(0);
  });

  it('forged writer tokens are rejected', () => {
    const { module } = recordingModule('frontline_td:test.m9', (builder) => {
      builder.claimWriter(Pos);
      builder.system({
        id: 'frontline_td:test.forge',
        phase: 'orders',
        run(ctx) {
          const forged = { ref: Pos, ownerId: 'frontline_td:test.m9' };
          expect(() => ctx.write(forged)).toThrow(/claimWriter/);
          const handle = ctx.spawn([[Tag]]);
          expect(() => {
            ctx.addComponent(forged, handle, { x: 1 });
          }).toThrow(/claimWriter/);
          expect(() => {
            ctx.removeComponent(forged, handle);
          }).toThrow(/claimWriter/);
        },
      });
    });
    const sim = createSimulation(baseConfig(), [module]);
    expect(() => {
      sim.step();
    }).not.toThrow();
  });
});
