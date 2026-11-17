// Site conversion, energy supply-state modifiers, set_priorities command
// validation, determinism, save/restore and terrain-blocker invalidation.
import { describe, expect, it } from 'vitest';
import { toTick, toFactionId } from '../../../core/index';
import type { EntityHandle } from '../../../core/index';
import { UnderConstruction } from '../../../kernel/index';
import { restoreSimulation } from '../../../kernel/index';
import type { SimModule } from '../../../kernel/index';
import { SetPrioritiesCommand } from '../protocol';
import { structureParts } from './parts';
import { EnergyEmptyModifier, EnergyLowModifier } from './index';
import {
  CYCLE,
  DB,
  ENERGY,
  F1,
  buildWorld,
  consumerParts,
  demandSlot,
  makeWorld,
  nodeParts,
  run,
  storeInit,
} from './test-world';
import { CARGO_CONSTRUCTION } from '../protocol';
import { moverParts } from './test-world';

const W = 80;
const H = 40;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));
const WAREHOUSE = { connect: 600, service: 15, vehicles: 12, warehouse: true };

describe('logistics state', () => {
  it('site conversion: dropping UnderConstruction installs the operational profile', () => {
    const depot = DB.structures.byId('frontline_td:supply_depot');
    expect(depot).toBeDefined();
    const w = buildWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: structureParts(depot ?? ({} as never), 30, 4, 'site', 0) },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 10]]) }],
    });
    // Claim UnderConstruction in a helper module and drop it at tick 2.
    const helper: SimModule = {
      id: 'frontline_td:test.uc',
      install(builder) {
        const ucW = builder.claimWriter(UnderConstruction);
        builder.system({
          id: 'frontline_td:test.uc.drop',
          phase: 'cleanup',
          run(ctx) {
            if (ctx.tick === 2) {
              ctx.removeComponent(ucW, w.handles[1] ?? (0 as EntityHandle));
            }
          },
        });
      },
    };
    w.modules.push(helper);
    w.open();
    run(w.sim, 2);
    run(w.sim, 2);
    const section = w.inspect(1);
    // SiteStore removed; the depot's operational reserve slots are live
    // (energy 100u + ammo 100u).
    expect(section?.slots).toHaveLength(2);
    expect(section?.slots[0]?.class).toBe('reserve');
    expect(section?.slots[0]?.capacity).toBe(100_000);
    expect(section?.slots[1]?.class).toBe('reserve');
    expect(section?.slots[1]?.capacity).toBe(100_000);
  });

  it('energy modifiers: low, empty, cleared after refill', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        {
          parts: moverParts(6, 6, storeInit([{ cargo: ENERGY, cap: 60000, amt: 10000, cls: 0 }])),
        },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 1000]]) }],
    });
    run(w.sim, CYCLE);
    // Lifeline demand refills from the warehouse, so the low state is gone
    // after one cycle.
    let out = w.sim.inspect(F1, w.handles[1] ?? (0 as EntityHandle));
    expect(out?.modifiers.map((m) => m.source)).not.toContain(EnergyLowModifier.id);

    // Now force the battery low: amt 10000 < 60000*3000/10000 = 18000 with
    // no stock to refill it.
    const w2 = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        {
          parts: moverParts(6, 6, storeInit([{ cargo: ENERGY, cap: 60000, amt: 10000, cls: 0 }])),
        },
      ],
    });
    run(w2.sim, CYCLE);
    out = w2.sim.inspect(F1, w2.handles[1] ?? (0 as EntityHandle));
    const lowMod = out?.modifiers.find((m) => m.source === EnergyLowModifier.id);
    expect(lowMod?.value).toBe(-7500);

    const w3 = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: moverParts(6, 6, storeInit([{ cargo: ENERGY, cap: 60000, amt: 0, cls: 0 }])) },
      ],
    });
    run(w3.sim, CYCLE);
    out = w3.sim.inspect(F1, w3.handles[1] ?? (0 as EntityHandle));
    const ids = out?.modifiers.map((m) => m.source) ?? [];
    expect(ids).toContain(EnergyEmptyModifier.id);
    expect(ids).not.toContain(EnergyLowModifier.id);
  });

  it('rejects invalid priority permutations without mutating', () => {
    const w = makeWorld({ rows: FLAT, entities: [{ parts: nodeParts(4, 4, WAREHOUSE) }] });
    for (const order of [['construction'], ['production', 'production'], ['x']]) {
      w.sim.submit({
        tick: toTick(1),
        issuer: F1,
        type: SetPrioritiesCommand.type,
        payload: { order },
      });
    }
    run(w.sim, 2);
    expect(w.network().priorities).toEqual(['lifeline', 'construction', 'production', 'reserve']);
  });

  it('deterministic: identical runs hash equally', () => {
    const opts = {
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, { connect: 400, service: 30, vehicles: 8 }) },
        {
          parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])),
        },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 100]]) }],
    };
    const a = makeWorld(opts);
    const b = makeWorld(opts);
    run(a.sim, CYCLE * 2 + 7);
    run(b.sim, CYCLE * 2 + 7);
    expect(a.sim.hash()).toBe(b.sim.hash());
  });

  it('save/restore mid-cycle: equal hash and identical network channel', () => {
    const opts = {
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, { connect: 400, service: 30, vehicles: 8 }) },
        {
          parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])),
        },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 100]]) }],
    };
    const a = makeWorld(opts);
    run(a.sim, CYCLE + 10); // mid-cycle
    const saved = a.sim.serialize();

    const b = buildWorld(opts);
    const restored = restoreSimulation(b.config, b.modules, saved);
    b.attach(restored);
    // Same hash at the save point; derived topology rebuilds lazily.
    run(a.sim, CYCLE);
    run(restored, CYCLE);
    expect(restored.hash()).toBe(a.sim.hash());
    const na = a.network();
    const nb = b.network();
    expect(JSON.stringify(nb.stock)).toBe(JSON.stringify(na.stock));
    expect([...nb.links.a]).toEqual([...na.links.a]);
    expect([...nb.links.pathCells]).toEqual([...na.links.pathCells]);
    expect([...nb.nodes.handles]).toEqual([...na.nodes.handles]);
    expect(nb.priorities).toEqual(na.priorities);
  });

  it('terrain blocker change invalidates the topology', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, { connect: 400, service: 30, vehicles: 8 }) },
        { parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])) },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 100]]) }],
    });
    run(w.sim, CYCLE);
    expect(w.network().links.a.length).toBe(1);
    // Wall off the entire column between the two footprints.
    w.terrain.setBlocked(
      Array.from({ length: H }, (_, i) => ({ x: 15, y: i })),
      true,
    );
    run(w.sim, CYCLE);
    expect(w.network().links.a.length).toBe(0);
    // cap 20000 is still unfilled -> keeps demanding, now unreachable.
    expect(w.inspect(2)?.slots[0]?.unmet).toBe('disconnected');
  });

  it('mirrored two-faction symmetry', () => {
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE), faction: 1 },
        { parts: nodeParts(30, 4, { connect: 400, service: 30, vehicles: 8 }), faction: 1 },
        {
          parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])),
          faction: 1,
        },
        { parts: nodeParts(75, 4, WAREHOUSE), faction: 2 },
        { parts: nodeParts(49, 4, { connect: 400, service: 30, vehicles: 8 }), faction: 2 },
        {
          parts: consumerParts(29, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])),
          faction: 2,
        },
      ],
      starts: [
        { faction: F1, stock: new Map([[ENERGY, 100]]) },
        { faction: toFactionId(2), stock: new Map([[ENERGY, 100]]) },
      ],
    });
    run(w.sim, CYCLE);
    const n1 = w.network(1);
    const n2 = w.network(2);
    expect(n1.nodes.handles.length).toBe(n2.nodes.handles.length);
    expect(n1.links.a.length).toBe(n2.links.a.length);
    expect(w.inspect(2)?.slots[0]?.amount).toBe(w.inspect(5, 2)?.slots[0]?.amount);
  });
});
