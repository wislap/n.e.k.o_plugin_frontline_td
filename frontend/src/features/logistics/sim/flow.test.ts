// Flow bookkeeping: cached-vs-rebuilt budget-tree equivalence, `since`
// ordering for newly spawned stores, export unmet reasons, and per-link
// utilization / saturation flags.
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../../../core/index';
import { Faction, InWorld } from '../../../kernel/index';
import {
  CARGO_CONSTRUCTION,
  CARGO_RESERVE,
  SLOT_EXPORT,
  SLOT_SITE,
  UNMET_NO_CAPACITY,
  UNMET_NOT_COVERED,
} from '../protocol';
import {
  CYCLE,
  DB,
  ENERGY,
  F1,
  consumerParts,
  makeWorld,
  nodeParts,
  run,
  storeInit,
} from './test-world';
import { CargoStore } from './components';
import { structureParts } from './parts';
import { INF, buildBudgetTree, qMax, travelCost, treePath } from './alloc';
import { buildFactionTopo } from './topology';
import type { FactionTopo, TopoNode } from './topology';

const W = 80;
const H = 40;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

// Naive reference allocation: serves one demand over `topo`, rebuilding
// the budget tree on EVERY iteration (what the cached DirFlow must be
// equivalent to). Pure alloc.ts helpers only; returns delivered milli.
function naiveServe(opts: {
  topo: FactionTopo;
  node: number;
  lastMile: number;
  need: number;
  stock: number;
  budgets: number[];
  loadMilli: number;
  dirt: number;
}): { delivered: number; reachable: boolean } {
  const { topo, node, lastMile, loadMilli, dirt } = opts;
  let need = opts.need;
  let stock = opts.stock;
  let delivered = 0;
  while (need > 0 && stock > 0) {
    const tree = buildBudgetTree(topo, opts.budgets, false);
    if (tree.reachable[node] !== 1) {
      return { delivered, reachable: false };
    }
    const path = treePath(topo, tree, node, false);
    if (path === null) {
      return { delivered, reachable: false };
    }
    let capQ = INF;
    for (const { payer, link } of path) {
      const l = topo.links[link];
      if (l !== undefined) {
        capQ = Math.min(capQ, qMax(opts.budgets[payer] ?? 0, l.cost, loadMilli, l.m));
      }
    }
    if (lastMile > 0) {
      capQ = Math.min(capQ, qMax(opts.budgets[node] ?? 0, lastMile, loadMilli, dirt));
    }
    const q = Math.min(need, capQ, stock);
    if (q <= 0) {
      break;
    }
    for (const { payer, link } of path) {
      const l = topo.links[link];
      if (l !== undefined) {
        opts.budgets[payer] = (opts.budgets[payer] ?? 0) - travelCost(l.cost, q, loadMilli, l.m);
      }
    }
    if (lastMile > 0) {
      opts.budgets[node] = (opts.budgets[node] ?? 0) - travelCost(lastMile, q, loadMilli, dirt);
    }
    stock -= q;
    need -= q;
    delivered += q;
  }
  return { delivered, reachable: true };
}

// Saturating scenario: the 2-vehicle warehouse budget (100 cost units)
// cannot cover the wh -> relay link (~280 cost units at full demand), so
// the tree must be rebuilt mid-cycle after the payer hits zero.
const SATURATION = {
  rows: FLAT,
  entities: [
    {
      parts: nodeParts(4, 4, { connect: 600, service: 30, vehicles: 2, warehouse: true }),
    },
    { parts: nodeParts(30, 4, { connect: 400, service: 30, vehicles: 8 }) },
    {
      parts: consumerParts(
        50,
        4,
        storeInit([{ cargo: ENERGY, cap: 200000, cls: CARGO_CONSTRUCTION }]),
      ),
    },
  ],
  starts: [{ faction: F1, stock: new Map([[ENERGY, 1000]]) }],
};

describe('budget tree caching', () => {
  it('cached trees match an always-rebuilt naive allocator under saturation', () => {
    const w = makeWorld(SATURATION);
    run(w.sim, CYCLE);
    // Reference: the same topology/budgets served by the naive
    // rebuild-every-iteration allocator.
    const node = (
      id: number,
      x: number,
      y: number,
      v: TopoNode['vehicles'],
      conn: number,
      wh: boolean,
    ): TopoNode => ({
      id,
      x,
      y,
      connect: conn,
      service: 30,
      vehicles: v,
      warehouse: wh,
      w: 1,
      h: 1,
    });
    const topo = buildFactionTopo(
      [node(1, 4.5, 4.5, 2, 600, true), node(2, 30.5, 4.5, 8, 400, false)],
      w.terrain,
      DB.movementClasses.byId('frontline_td:ground')?.index ?? 0,
      DB.logistics.roadLevels[0]?.multiplierBp ?? 10000,
    );
    const cell = 4 * w.terrain.width + 50;
    const attached = topo.attach[cell] ?? -1;
    expect(attached).toBe(1);
    const travel = DB.logistics.vehicleTravelPerCycle;
    const naive = naiveServe({
      topo,
      node: attached,
      lastMile: topo.attachCost[cell] ?? 0,
      need: 200000,
      stock: 1_000_000,
      budgets: [2 * travel, 8 * travel],
      loadMilli: DB.logistics.vehicleLoadMilli,
      dirt: DB.logistics.roadLevels[0]?.multiplierBp ?? 10000,
    });
    expect(w.inspect(2)?.slots[0]?.amount).toBe(naive.delivered);
    expect(naive.reachable).toBe(false); // wh saturated -> unreachable
    expect(w.inspect(2)?.slots[0]?.unmet).toBe('no_capacity');
  });
});

describe('link utilization and saturation', () => {
  it('saturated outbound link flags the upstream payer', () => {
    const w = makeWorld(SATURATION);
    run(w.sim, CYCLE);
    const net = w.network();
    expect(net.links.a.length).toBe(1);
    // The warehouse pays outbound; its 100 budget is exhausted exactly.
    expect(net.links.outBp[0]).toBe(10000);
    expect(net.links.outSat[0]).toBe(1);
    expect(net.links.inBp[0]).toBe(0);
    expect(net.links.inSat[0]).toBe(0);
    // Consumer gets a partial delivery; the warehouse is the bottleneck.
    expect(w.inspect(2)?.slots[0]?.unmet).toBe('no_capacity');
    expect(w.inspect(2)?.bottleneck).toBe(Number(w.handles[0]));
  });

  it('inbound saturation pays the far end and counts unmetExport', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        {
          parts: nodeParts(4, 4, { connect: 600, service: 30, vehicles: 8, warehouse: true }),
        },
        {
          parts: nodeParts(
            30,
            4,
            { connect: 400, service: 30, vehicles: 2 },
            storeInit([
              { cargo: ENERGY, cap: 200000, amt: 200000, cls: CARGO_RESERVE, flags: SLOT_EXPORT },
            ]),
          ),
        },
      ],
    });
    run(w.sim, CYCLE);
    const net = w.network();
    expect(net.links.inBp[0]).toBe(10000);
    expect(net.links.inSat[0]).toBe(1);
    expect(net.links.outSat[0]).toBe(0);
    // The export slot reports no_capacity with the relay as bottleneck,
    // counted in unmetExport (not unmet).
    expect(w.inspect(1)?.slots[0]?.unmet).toBe('no_capacity');
    expect(w.inspect(1)?.bottleneck).toBe(Number(w.handles[1]));
    expect(net.unmetExport[UNMET_NO_CAPACITY]).toBe(1);
    expect(net.unmet.every((n) => n === 0)).toBe(true);
  });
});

describe('export unmet reasons', () => {
  it('not_covered: export slot outside every service radius', () => {
    const w = makeWorld({
      rows: FLAT,
      entities: [
        {
          parts: nodeParts(4, 4, { connect: 600, service: 10, vehicles: 8, warehouse: true }),
        },
        {
          parts: consumerParts(
            60,
            30,
            storeInit([
              { cargo: ENERGY, cap: 10000, amt: 5000, cls: CARGO_RESERVE, flags: SLOT_EXPORT },
            ]),
          ),
        },
      ],
    });
    run(w.sim, CYCLE);
    expect(w.inspect(1)?.slots[0]?.unmet).toBe('not_covered');
    expect(w.inspect(1)?.slots[0]?.amount).toBe(5000);
    expect(w.network().unmetExport[UNMET_NOT_COVERED]).toBe(1);
  });
});

describe('demand ordering by since', () => {
  it('an older open demand beats a store spawned mid-cycle, same class', () => {
    // Site slot spawned at tick 0 (since = 1); a reserve slot of the same
    // class spawns at tick 10 and is stamped tick + 1 at collection, so
    // the site wins the only unit of stock.
    const w = makeWorld({
      rows: FLAT,
      entities: [
        {
          parts: nodeParts(4, 4, { connect: 600, service: 30, vehicles: 8, warehouse: true }),
        },
        {
          parts: consumerParts(
            10,
            4,
            storeInit([
              { cargo: ENERGY, cap: 1000, cls: CARGO_RESERVE, flags: SLOT_SITE, since: 1 },
            ]),
          ),
        },
      ],
      starts: [{ faction: F1, stock: new Map([[ENERGY, 1]]) }],
      onTick: (ctx, handles) => {
        if (ctx.tick === 10) {
          (handles as EntityHandle[]).push(
            ctx.spawn([
              [Faction, { id: 1 }],
              [InWorld],
              ...consumerParts(
                12,
                4,
                storeInit([{ cargo: ENERGY, cap: 1000, cls: CARGO_RESERVE }]),
              ),
            ]),
          );
        }
      },
    });
    run(w.sim, CYCLE + 1);
    expect(w.inspect(1)?.slots[0]?.amount).toBe(1000);
    expect(w.inspect(2)?.slots[0]?.amount).toBe(0);
    expect(w.inspect(2)?.slots[0]?.unmet).toBe('no_stock');
  });

  it('spawned non-full store gets since = tick + 1 (parts encoding)', () => {
    const depot = DB.structures.byId('frontline_td:supply_depot');
    if (depot === undefined) {
      throw new Error('supply_depot structure missing from base pack');
    }
    const init = structureParts(depot, 10, 10, 'complete', 5);
    const store = init.find(([ref]) => ref.id === CargoStore.id);
    const values = store?.[1] as Record<string, number>;
    // Complete-phase empty reserve slot: an open demand stamped tick + 1.
    expect(values['since0']).toBe(6);
    expect(values['amt0']).toBe(0);
  });
});
