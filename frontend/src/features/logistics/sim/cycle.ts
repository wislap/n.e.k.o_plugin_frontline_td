// Per-cycle allocation (runs every cfg.cycleTicks ticks, offset 0):
// rates first, then outbound demands, reserve fallback, inbound exports,
// supply-state modifiers and link-utilization bookkeeping.
import type { EntityId } from '../../../core/index';
import { floorDiv } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import { Mover, Position } from '../../movement/sim/index';
import {
  CARGO_RESERVE,
  UNMET_DISCONNECTED,
  UNMET_NONE,
  UNMET_NOT_COVERED,
  UNMET_NO_CAPACITY,
  UNMET_NO_STOCK,
} from '../protocol';
import {
  INF,
  effectiveVehicles,
  firstBrokePayer,
  fullTree,
  qMax,
  travelCost,
  treePath,
} from './alloc';
import {
  CARGO_SLOTS,
  EMPTY_CARGO,
  EnergyEmptyModifier,
  EnergyLowModifier,
  CargoStore,
} from './components';
import type { LogisticsEnv } from './env';
import {
  chargeLastMile,
  chargeLink,
  collectDemands,
  collectExports,
  flowTree,
  newFlow,
  rankDemands,
  utilization,
} from './flow';
import { sget, sset } from './slots';

export function runCycle(env: LogisticsEnv, ctx: SystemContext, faction: number): void {
  const { cfg, dirt, energyIdx, healthBp, cargoW, lowW, emptyW } = env;
  const topo = env.topos.get(faction);
  const state = env.stateOf(faction);
  state.unmet.fill(0);
  state.unmetExport.fill(0);
  if (topo === undefined) {
    return;
  }
  const store = ctx.write(cargoW);
  const fac = ctx.read(Faction);
  const pos = ctx.read(Position);
  const tick = ctx.tick;

  // --- rates apply once per cycle, before allocation ---
  for (const id of ctx.query([CargoStore, Faction])) {
    if ((fac.id[id] ?? 0) !== faction) {
      continue;
    }
    for (let i = 0; i < CARGO_SLOTS; i++) {
      if (sget(store, 'cargo', i, id) === EMPTY_CARGO) {
        continue;
      }
      const cap = sget(store, 'cap', i, id);
      const amt = sget(store, 'amt', i, id);
      const next = Math.min(cap, Math.max(0, amt + sget(store, 'rate', i, id)));
      sset(store, 'amt', i, id, next);
      // since = first drop below full, encoded tick + 1 (0 = none).
      if (amt >= cap && next < cap) {
        sset(store, 'since', i, id, tick + 1);
      } else if (next >= cap) {
        sset(store, 'since', i, id, 0);
      }
    }
  }

  // --- per-node budgets (outbound and inbound are independent) ---
  const eff = topo.nodes.map((n) =>
    effectiveVehicles(n.vehicles, healthBp(ctx, n.id as EntityId), cfg.hpBandsBp),
  );
  const fullB = eff.map((v) => v * cfg.vehicleTravelPerCycle);
  const outF = newFlow(fullB, topo.links.length);
  const inF = newFlow(fullB, topo.links.length);
  // Full-graph tree: reachability, bottleneck paths, link-payer direction.
  const full = fullTree(topo);

  // --- outbound demands ---
  const demands = collectDemands(ctx, store, faction, tick);
  rankDemands(demands, state.priorities);

  for (const d of demands) {
    const cap = sget(store, 'cap', d.slot, d.id);
    let need = cap - sget(store, 'amt', d.slot, d.id);
    const attach = env.attachOf(ctx, topo, d.id, pos.x[d.id] ?? 0, pos.y[d.id] ?? 0);
    if (attach === null) {
      sset(store, 'unmet', d.slot, d.id, UNMET_NOT_COVERED);
      state.unmet[UNMET_NOT_COVERED] = (state.unmet[UNMET_NOT_COVERED] ?? 0) + 1;
      continue;
    }
    let unmet = UNMET_NONE;
    let bottleneckId = 0;
    while (need > 0) {
      if ((state.stock[d.cargo] ?? 0) <= 0) {
        unmet = UNMET_NO_STOCK;
        break;
      }
      const tree = flowTree(outF, topo, false);
      if (tree.reachable[attach.node] !== 1) {
        if (full.reachable[attach.node] === 1) {
          unmet = UNMET_NO_CAPACITY;
          // First exhausted payer on the shortest full-graph path,
          // warehouse -> out; -1 means the last mile is the limiter.
          const broke = firstBrokePayer(topo, full, attach.node, false, outF.budgets);
          bottleneckId = topo.nodes[broke < 0 ? attach.node : broke]?.id ?? 0;
        } else {
          unmet = UNMET_DISCONNECTED;
        }
        break;
      }
      const path = treePath(topo, tree, attach.node, false);
      if (path === null) {
        unmet = UNMET_DISCONNECTED;
        break;
      }
      let capQ = INF;
      let bneck = attach.node;
      for (const { payer, link } of path) {
        const l = topo.links[link];
        if (l === undefined) {
          continue;
        }
        const qm = qMax(outF.budgets[payer] ?? 0, l.cost, cfg.vehicleLoadMilli, l.m);
        if (qm < capQ) {
          capQ = qm;
          bneck = payer;
        }
      }
      if (attach.lastMile > 0) {
        const qm = qMax(
          outF.budgets[attach.node] ?? 0,
          attach.lastMile,
          cfg.vehicleLoadMilli,
          dirt,
        );
        if (qm < capQ) {
          capQ = qm;
          bneck = attach.node;
        }
      }
      const q = Math.min(need, capQ, state.stock[d.cargo] ?? 0);
      if (q <= 0) {
        unmet = UNMET_NO_CAPACITY;
        bottleneckId = topo.nodes[bneck]?.id ?? 0;
        break;
      }
      sset(store, 'amt', d.slot, d.id, sget(store, 'amt', d.slot, d.id) + q);
      state.stock[d.cargo] = (state.stock[d.cargo] ?? 0) - q;
      need -= q;
      for (const { payer, link } of path) {
        const l = topo.links[link];
        if (l === undefined) {
          continue;
        }
        const t = travelCost(l.cost, q, cfg.vehicleLoadMilli, l.m);
        chargeLink(outF, fullB, payer, link, t);
        if ((outF.budgets[payer] ?? 0) <= 0) {
          bottleneckId = topo.nodes[payer]?.id ?? 0;
        }
      }
      if (attach.lastMile > 0) {
        const t = travelCost(attach.lastMile, q, cfg.vehicleLoadMilli, dirt);
        chargeLastMile(outF, attach.node, t);
        if ((outF.budgets[attach.node] ?? 0) <= 0) {
          bottleneckId = topo.nodes[attach.node]?.id ?? 0;
        }
      }
    }

    // Reserve fallback: remaining need draws from the attached node's
    // own reserve slots, paying only the last mile.
    if (need > 0) {
      const nodeId = topo.nodes[attach.node]?.id;
      if (nodeId !== undefined && ctx.has(CargoStore, nodeId as EntityId)) {
        for (let i = 0; i < CARGO_SLOTS && need > 0; i++) {
          if (sget(store, 'cargo', i, nodeId) !== d.cargo) {
            continue;
          }
          if (sget(store, 'cls', i, nodeId) !== CARGO_RESERVE) {
            continue; // reserve class only
          }
          const qm =
            attach.lastMile > 0
              ? qMax(outF.budgets[attach.node] ?? 0, attach.lastMile, cfg.vehicleLoadMilli, dirt)
              : INF;
          const q2 = Math.min(need, sget(store, 'amt', i, nodeId), qm);
          if (q2 <= 0) {
            continue;
          }
          sset(store, 'amt', i, nodeId, sget(store, 'amt', i, nodeId) - q2);
          sset(store, 'amt', d.slot, d.id, sget(store, 'amt', d.slot, d.id) + q2);
          if (attach.lastMile > 0) {
            chargeLastMile(
              outF,
              attach.node,
              travelCost(attach.lastMile, q2, cfg.vehicleLoadMilli, dirt),
            );
          }
          need -= q2;
        }
      }
    }

    if (unmet === UNMET_NONE && need > 0) {
      unmet = UNMET_NO_STOCK;
    }
    sset(store, 'unmet', d.slot, d.id, unmet);
    if (unmet !== UNMET_NONE) {
      const bh = ctx.handleOf(bottleneckId as EntityId);
      store.bottleneck[d.id] = bh === null ? 0 : Number(bh);
      state.unmet[unmet] = (state.unmet[unmet] ?? 0) + 1;
    } else {
      store.bottleneck[d.id] = 0;
      sset(store, 'unmet', d.slot, d.id, UNMET_NONE);
    }
  }

  // --- inbound: export buffers ship home over the same network ---
  for (const e of collectExports(ctx, store, faction)) {
    // Export slots get the same unmet reasons as demands so the client
    // can show "cannot ship home"; counted separately in unmetExport.
    let unmet = UNMET_NONE;
    let bottleneckId = 0;
    const fail = (reason: number, bneckNode: number): void => {
      unmet = reason;
      bottleneckId = topo.nodes[bneckNode]?.id ?? 0;
    };
    const attach = env.attachOf(ctx, topo, e.id, pos.x[e.id] ?? 0, pos.y[e.id] ?? 0);
    if (attach === null) {
      unmet = UNMET_NOT_COVERED;
    }
    while (attach !== null && unmet === UNMET_NONE && sget(store, 'amt', e.slot, e.id) > 0) {
      const tree = flowTree(inF, topo, true);
      if (tree.reachable[attach.node] !== 1) {
        if (full.reachable[attach.node] === 1) {
          const broke = firstBrokePayer(topo, full, attach.node, true, inF.budgets);
          fail(UNMET_NO_CAPACITY, broke < 0 ? attach.node : broke);
        } else {
          fail(UNMET_DISCONNECTED, attach.node);
        }
        break;
      }
      const path = treePath(topo, tree, attach.node, true);
      if (path === null) {
        fail(UNMET_DISCONNECTED, attach.node);
        break;
      }
      let capQ = INF;
      let bneck = attach.node;
      for (const { payer, link } of path) {
        const l = topo.links[link];
        if (l === undefined) {
          continue;
        }
        const qm = qMax(inF.budgets[payer] ?? 0, l.cost, cfg.vehicleLoadMilli, l.m);
        if (qm < capQ) {
          capQ = qm;
          bneck = payer;
        }
      }
      if (attach.lastMile > 0) {
        const qm = qMax(inF.budgets[attach.node] ?? 0, attach.lastMile, cfg.vehicleLoadMilli, dirt);
        if (qm < capQ) {
          capQ = qm;
          bneck = attach.node;
        }
      }
      const q = Math.min(sget(store, 'amt', e.slot, e.id), capQ);
      if (q <= 0) {
        fail(UNMET_NO_CAPACITY, bneck);
        break;
      }
      sset(store, 'amt', e.slot, e.id, sget(store, 'amt', e.slot, e.id) - q);
      state.stock[e.cargo] = (state.stock[e.cargo] ?? 0) + q;
      for (const { payer, link } of path) {
        const l = topo.links[link];
        if (l === undefined) {
          continue;
        }
        chargeLink(inF, fullB, payer, link, travelCost(l.cost, q, cfg.vehicleLoadMilli, l.m));
      }
      if (attach.lastMile > 0) {
        chargeLastMile(
          inF,
          attach.node,
          travelCost(attach.lastMile, q, cfg.vehicleLoadMilli, dirt),
        );
      }
    }
    sset(store, 'unmet', e.slot, e.id, unmet);
    if (unmet !== UNMET_NONE) {
      const bh = ctx.handleOf(bottleneckId as EntityId);
      store.bottleneck[e.id] = bh === null ? 0 : Number(bh);
      state.unmetExport[unmet] = (state.unmetExport[unmet] ?? 0) + 1;
    }
  }

  // --- supply-state modifiers on movers with an energy slot ---
  if (energyIdx >= 0) {
    for (const id of ctx.query([CargoStore, Mover, Faction])) {
      if ((fac.id[id] ?? 0) !== faction) {
        continue;
      }
      let eSlot = -1;
      for (let i = 0; i < CARGO_SLOTS; i++) {
        if (sget(store, 'cargo', i, id) === energyIdx) {
          eSlot = i;
          break;
        }
      }
      if (eSlot < 0) {
        continue;
      }
      const amt = sget(store, 'amt', eSlot, id);
      const cap = sget(store, 'cap', eSlot, id);
      const handle = ctx.handleOf(id as EntityId);
      if (handle === null) {
        continue;
      }
      const low = amt < floorDiv(cap * cfg.lowThresholdBp, 10000);
      const empty = amt === 0;
      if (empty && !ctx.has(EnergyEmptyModifier, id as EntityId)) {
        ctx.addComponent(emptyW, handle, { value: -10000 });
      } else if (!empty && ctx.has(EnergyEmptyModifier, id as EntityId)) {
        ctx.removeComponent(emptyW, handle);
      }
      if (!empty && low && !ctx.has(EnergyLowModifier, id as EntityId)) {
        ctx.addComponent(lowW, handle, { value: cfg.lowSpeedBp });
      } else if ((empty || !low) && ctx.has(EnergyLowModifier, id as EntityId)) {
        ctx.removeComponent(lowW, handle);
      }
    }
  }

  // --- link utilization bookkeeping ---
  const outU = utilization(outF, topo, full, fullB, false);
  const inU = utilization(inF, topo, full, fullB, true);
  state.outBp = outU.bp;
  state.outSat = outU.sat;
  state.inBp = inU.bp;
  state.inSat = inU.sat;
}
