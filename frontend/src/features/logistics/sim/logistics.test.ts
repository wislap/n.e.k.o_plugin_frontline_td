// Allocation behaviour: budgets, exact capacity math, priority order,
// attachment, unmet reasons, reserves and inbound routing.
import { describe, expect, it } from 'vitest';
import { toTick } from '../../../core/index';
import { SetPrioritiesCommand, SLOT_EXPORT } from '../protocol';
import { CARGO_CONSTRUCTION, CARGO_PRODUCTION, CARGO_RESERVE } from '../protocol';
import { qMax, travelCost } from './alloc';
import { structureParts, unitParts } from './parts';
import { CargoStore, Interceptor, LogisticsNode } from './index';
import {
  CYCLE,
  DB,
  ENERGY,
  F1,
  consumerParts,
  demandSlot,
  makeWorld,
  nodeParts,
  run,
  storeInit,
} from './test-world';

const W = 80;
const H = 40;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

// Warehouse node (12 vehicles, budget 600 cost-units/cycle) and a relay
// (8 vehicles, budget 400) ~28 cells away so the link (~280) leaves the
// warehouse capacity above the relay's 200-cost last mile (5000 milli).
const WAREHOUSE = { connect: 600, service: 10, vehicles: 12, warehouse: true };
const RELAY = { connect: 400, service: 30, vehicles: 8 };

describe('logistics allocation', () => {
  it('formula: T(q) and qMax round exactly (station 8v, load 5, speed 5, L=200, dirt)', () => {
    const load = DB.logistics.vehicleLoadMilli; // 5000
    const m = 10000;
    // T(5000m) = 2*200*5000*10000 / (5000*10000) = 400 cost units.
    expect(travelCost(200, 5000, load, m)).toBe(400);
    expect(travelCost(200, 1, load, m)).toBe(1); // ceil, never 0
    expect(travelCost(0, 99999, load, m)).toBe(0); // free last mile
    // qMax(400) = 400*5000*10000 / (2*200*10000) = 5000 milli = 5 units.
    expect(qMax(400, 200, load, m)).toBe(5000);
  });

  it('hand-computed: relay last mile L=200 delivers exactly 5000 milli/cycle', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, RELAY) },
        // 20 cells from the relay: last mile = 200 cost units.
        { parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 5000, CARGO_CONSTRUCTION)])) },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 100]]) }],
    });
    run(w.sim, CYCLE);
    // qMax(400, 200, 5000, 10000) = 5000 milli = 5 units per cycle.
    expect(w.inspect(2)?.slots[0]?.amount).toBe(5000);
    expect(w.inspect(2)?.slots[0]?.unmet).toBe('none');
    run(w.sim, CYCLE);
    expect(w.inspect(2)?.slots[0]?.amount).toBe(5000);
    expect(w.network().unmet.every((n) => n === 0)).toBe(true);
  });

  it('priority order: construction before production by default, flipped by command', () => {
    // One relay with a tiny budget: only ~5000 milli fits per cycle.
    const relay = { connect: 400, service: 30, vehicles: 8 };
    const mk = () =>
      makeWorld({
        rows: FLAT,
        entities: [
          { parts: nodeParts(4, 4, WAREHOUSE) },
          { parts: nodeParts(30, 4, relay) },
          {
            parts: consumerParts(
              50,
              4,
              storeInit([{ cargo: ENERGY, cap: 10000, cls: CARGO_CONSTRUCTION, rate: -10000 }]),
            ),
          },
          {
            parts: consumerParts(
              52,
              4,
              storeInit([{ cargo: ENERGY, cap: 10000, cls: CARGO_PRODUCTION, rate: -10000 }]),
            ),
          },
        ],
        starts: [{ faction: F1, stock: new Map([[ENERGY, 1000]]) }],
      });
    const w = mk();
    run(w.sim, CYCLE);
    // Construction demand wins the whole 5000 milli capacity.
    expect(w.inspect(2)?.slots[0]?.amount).toBe(5000);
    expect(w.inspect(3)?.slots[0]?.amount).toBe(0);
    expect(w.inspect(3)?.slots[0]?.unmet).toBe('no_capacity');

    w.sim.submit({
      tick: toTick(w.sim.tick + 1),
      issuer: F1,
      type: SetPrioritiesCommand.type,
      payload: { order: ['production', 'construction'] },
    });
    // Cycle boundaries land on steps 1, 21, 41, ... — one extra step
    // crosses the next boundary after the command's own tick.
    run(w.sim, CYCLE + 1);
    // After the flip production drains first (rate emptied both slots);
    // its last mile is 22 cells -> qMax(400,220)=4545.
    expect(w.inspect(3)?.slots[0]?.amount).toBe(4545);
    expect(w.inspect(2)?.slots[0]?.amount).toBe(0);
    expect(w.inspect(2)?.slots[0]?.unmet).toBe('no_capacity');
    expect(w.network().priorities).toEqual(['lifeline', 'production', 'construction', 'reserve']);
  });

  it('first-come-first-served within a class: lower entity id wins the tie', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, RELAY) },
        {
          parts: consumerParts(
            50,
            4,
            storeInit([{ cargo: ENERGY, cap: 10000, cls: CARGO_CONSTRUCTION, rate: -10000 }]),
          ),
        },
        {
          parts: consumerParts(
            52,
            4,
            storeInit([{ cargo: ENERGY, cap: 10000, cls: CARGO_CONSTRUCTION, rate: -10000 }]),
          ),
        },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 1000]]) }],
    });
    run(w.sim, CYCLE);
    expect(w.inspect(2)?.slots[0]?.amount).toBe(5000);
    expect(w.inspect(3)?.slots[0]?.amount).toBe(0);
  });

  it('unmet reasons: not_covered, no_stock, disconnected, no_capacity', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        // Isolated node: service covers its consumer but connect is ~0.
        {
          parts: nodeParts(60, 4, { connect: 5, service: 10, vehicles: 4 }),
        },
        // Dead relay: covered but zero vehicles -> no last-mile capacity.
        { parts: nodeParts(30, 30, { connect: 400, service: 10, vehicles: 0 }) },
        // Consumers:
        { parts: consumerParts(60, 6, storeInit([demandSlot(ENERGY, 5000, CARGO_CONSTRUCTION)])) },
        { parts: consumerParts(30, 32, storeInit([demandSlot(ENERGY, 5000, CARGO_CONSTRUCTION)])) },
        { parts: consumerParts(70, 30, storeInit([demandSlot(ENERGY, 5000, CARGO_CONSTRUCTION)])) },
        { parts: consumerParts(10, 10, storeInit([demandSlot(ENERGY, 5000, CARGO_CONSTRUCTION)])) },
      ],
      // stock stays empty for the covered-in-range consumer (no_stock);
      // energy stock exists only in the warehouse, which has none -> use
      // ore-free setup: give energy to make only the no_capacity case hit.
      starts: [{ faction: F1, stock: new Map([[ENERGY, 1]]) }],
    });
    run(w.sim, CYCLE);
    // covered by the isolated node -> disconnected
    expect(w.inspect(3)?.slots[0]?.unmet).toBe('disconnected');
    // covered by the dead relay -> no_capacity, bottleneck = relay handle
    expect(w.inspect(4)?.slots[0]?.unmet).toBe('no_capacity');
    expect(w.inspect(4)?.bottleneck).toBe(Number(w.handles[2]));
    // outside every service radius -> not_covered
    expect(w.inspect(5)?.slots[0]?.unmet).toBe('not_covered');
    // covered by the warehouse, stock=1 unit < need -> delivered then restock
    // falls to 0 -> remaining need is no_stock.
    const covered = w.inspect(6)?.slots[0];
    expect(covered?.amount).toBe(1000);
    expect(covered?.unmet).toBe('no_stock');
  });

  it('reserve fallback: draws from the attached node reserve when stock is empty', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        {
          parts: nodeParts(
            30,
            4,
            { connect: 400, service: 30, vehicles: 8 },
            storeInit([{ cargo: ENERGY, cap: 500000, amt: 3000, cls: CARGO_RESERVE }]),
          ),
        },
        { parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 5000, CARGO_CONSTRUCTION)])) },
      ],
      starts: [{ faction: F1 }],
    });
    run(w.sim, CYCLE);
    const consumer = w.inspect(2)?.slots[0];
    expect(consumer?.amount).toBe(3000);
    // Reserve drained; remainder unmet (warehouse stock is empty).
    expect(w.inspect(1)?.slots[0]?.amount).toBe(0);
    expect(consumer?.unmet).toBe('no_stock');
  });

  it('inbound is independent of the outbound budget', () => {
    // Relay with 1 vehicle: outbound budget 50 cost units — the consumer's
    // last mile (200) caps outbound, while the export ships inbound freely.
    const relay = { connect: 400, service: 30, vehicles: 1 };
    const w = makeWorld({
      rows: FLAT,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        {
          parts: nodeParts(
            30,
            4,
            relay,
            storeInit([
              { cargo: ENERGY, cap: 100000, amt: 10000, cls: CARGO_RESERVE, flags: SLOT_EXPORT },
            ]),
          ),
        },
        { parts: consumerParts(50, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])) },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 1000]]) }],
    });
    run(w.sim, CYCLE);
    // Outbound over the 200-cost last mile with 50 budget: qMax(50)=625.
    expect(w.inspect(2)?.slots[0]?.amount).toBe(625);
    // Inbound shipped despite the exhausted outbound budget: stock =
    // 1000000 - 625 outbound + (0..10000) shipped inbound over the link.
    const stock = w.network().stock[ENERGY] ?? -1;
    expect(stock).toBeGreaterThan(1000000 - 625);
    expect(stock).toBeLessThanOrEqual(1000000 - 625 + 10000);
  });

  it('self-attachment: a node exports into the warehouse for free', () => {
    // Generator node = warehouse itself with a +2/s export slot.
    const gen = nodeParts(
      4,
      4,
      WAREHOUSE,
      storeInit([
        { cargo: ENERGY, cap: 500000, cls: CARGO_RESERVE, flags: SLOT_EXPORT, rate: 2000 },
      ]),
    );
    const w = makeWorld({ rows: FLAT, entities: [{ parts: gen }] });
    run(w.sim, CYCLE);
    expect(w.network().stock[ENERGY]).toBe(2000);
    run(w.sim, CYCLE);
    expect(w.network().stock[ENERGY]).toBe(4000);
  });

  it('reroutes around a saturated node within the same cycle', () => {
    // wh -> A -> C preferred over wh -> B -> C; the warehouse connect bound
    // (200) blocks the direct wh -> C link. A has 1 vehicle; B has 8.
    const mk = (withB: boolean) =>
      makeWorld({
        rows: FLAT,
        entities: [
          { parts: nodeParts(4, 10, { connect: 200, service: 10, vehicles: 12, warehouse: true }) },
          { parts: nodeParts(20, 10, { connect: 400, service: 20, vehicles: 1 }) },
          ...(withB
            ? [{ parts: nodeParts(20, 24, { connect: 400, service: 20, vehicles: 8 }) }]
            : []),
          {
            parts: nodeParts(
              40,
              16,
              { connect: 400, service: 20, vehicles: 4 },
              storeInit([{ cargo: ENERGY, cap: 100000, cls: CARGO_CONSTRUCTION }]),
            ),
          },
        ],
        starts: [{ faction: F1, stock: new Map([[ENERGY, 1000]]) }],
      });
    const solo = mk(false);
    run(solo.sim, CYCLE);
    const viaA = solo.inspect(2)?.slots[0]?.amount ?? -1;

    const both = mk(true);
    run(both.sim, CYCLE);
    const withReroute = both.inspect(3)?.slots[0]?.amount ?? -1;
    // With B in the graph the demand gets strictly more than the saturated
    // A-only path could carry.
    expect(viaA).toBeGreaterThan(0);
    expect(withReroute).toBeGreaterThan(viaA);
  });

  it('spawn parts: robot battery and complete structure profile', () => {
    const robot = DB.units.byId('frontline_td:robot');
    if (robot === undefined) {
      throw new Error('robot unit missing from base pack');
    }
    const parts = unitParts(robot);
    expect(parts).toHaveLength(1);
    const values = (parts[0] ?? [])[1] as Record<string, number>;
    expect(values['cargo0']).toBe(ENERGY);
    expect(values['cap0']).toBe(60000);
    expect(values['amt0']).toBe(60000);
    expect(values['rate0']).toBe(-50);
    expect(values['cls0']).toBe(0); // lifeline

    const depot = DB.structures.byId('frontline_td:supply_depot');
    if (depot === undefined) {
      throw new Error('supply_depot structure missing from base pack');
    }
    const init = structureParts(depot, 10, 10, 'complete', 0);
    const refs = init.map(([ref]) => ref.id);
    expect(refs).toContain(LogisticsNode.id);
    expect(refs).toContain(CargoStore.id);
    const store = init.find(([ref]) => ref.id === CargoStore.id);
    expect((store?.[1] as Record<string, number>)['cap0']).toBe(100_000);
  });

  it('spawn parts: raider carries an Interceptor component (E2)', () => {
    const raider = DB.units.byId('frontline_td:raider');
    if (raider === undefined) {
      throw new Error('raider unit missing from base pack');
    }
    const parts = unitParts(raider);
    const inter = parts.find(([ref]) => ref.id === Interceptor.id);
    expect((inter?.[1] as Record<string, number>)['strengthBp']).toBe(5000);
    const robot = DB.units.byId('frontline_td:robot');
    if (robot === undefined) {
      throw new Error('robot unit missing from base pack');
    }
    expect(unitParts(robot).find(([ref]) => ref.id === Interceptor.id)).toBeUndefined();
  });
});
