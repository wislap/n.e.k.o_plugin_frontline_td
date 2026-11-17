// Cycle plumbing: demand/export collection, and the per-direction flow
// ledger that tracks remaining payer budgets, per-link utilization shares
// and the cached budget tree (rebuilt only after a payer hits zero — the
// tree edges depend solely on payer budget > 0, so this is identical to
// rebuilding on every use).
import { floorDiv } from '../../../core/index';
import type { EntityId } from '../../../core/index';
import { Faction, InWorld, UnderConstruction } from '../../../kernel/index';
import type { SystemContext } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import { CARGO_RESERVE, SLOT_EXPORT, SLOT_SITE } from '../protocol';
import type { CargoRead, CargoView } from './slots';
import { sget, sset } from './slots';
import { INF, buildBudgetTree } from './alloc';
import type { BudgetTree } from './alloc';
import type { FactionTopo } from './topology';
import { CargoStore, CARGO_SLOTS, EMPTY_CARGO } from './components';

export interface Demand {
  id: number;
  slot: number;
  cls: number;
  since: number;
  cargo: number;
}

export interface ExportSlot {
  id: number;
  slot: number;
  since: number;
  cargo: number;
}

// Open demand slots of a faction, oldest first within each priority class.
// An open demand with since = 0 (spawned before the encoding or filled
// then drained below cap without a rate tick) starts now: stamp tick + 1.
export function collectDemands(
  ctx: SystemContext,
  store: CargoView,
  faction: number,
  tick: number,
): Demand[] {
  const fac = ctx.read(Faction);
  const demands: Demand[] = [];
  const ids = ctx.query([CargoStore, Position, Faction, InWorld]);
  for (const id of ids) {
    if ((fac.id[id] ?? 0) !== faction) {
      continue;
    }
    const uc = ctx.has(UnderConstruction, id as EntityId);
    for (let i = 0; i < CARGO_SLOTS; i++) {
      const cargo = sget(store, 'cargo', i, id);
      if (cargo === EMPTY_CARGO) {
        continue;
      }
      const flags = sget(store, 'flags', i, id);
      if ((flags & SLOT_EXPORT) !== 0) {
        continue;
      }
      if (uc && (flags & SLOT_SITE) === 0) {
        continue; // under-construction entities only demand site slots
      }
      if (sget(store, 'amt', i, id) >= sget(store, 'cap', i, id)) {
        continue;
      }
      let since = sget(store, 'since', i, id);
      if (since === 0) {
        since = tick + 1;
        sset(store, 'since', i, id, since);
      }
      demands.push({ id, slot: i, cls: sget(store, 'cls', i, id), since, cargo });
    }
  }
  return demands;
}

// Demand order: class rank (lifeline < adjustable order < reserve), then
// oldest first, then entity id, then slot.
export function rankDemands(demands: Demand[], order: readonly number[]): void {
  const rankOf = (cls: number): number => {
    if (cls === 0) {
      return 0;
    }
    if (cls === CARGO_RESERVE) {
      return order.length + 1;
    }
    const idx = order.indexOf(cls);
    return idx < 0 ? order.length + 1 : 1 + idx;
  };
  demands.sort(
    (a, b) => rankOf(a.cls) - rankOf(b.cls) || a.since - b.since || a.id - b.id || a.slot - b.slot,
  );
}

// Export slots with cargo on hand, oldest first.
export function collectExports(
  ctx: SystemContext,
  store: CargoRead,
  faction: number,
): ExportSlot[] {
  const fac = ctx.read(Faction);
  const out: ExportSlot[] = [];
  for (const id of ctx.query([CargoStore, Faction, InWorld])) {
    if ((fac.id[id] ?? 0) !== faction) {
      continue;
    }
    for (let i = 0; i < CARGO_SLOTS; i++) {
      const cargo = sget(store, 'cargo', i, id);
      if (cargo === EMPTY_CARGO || (sget(store, 'flags', i, id) & SLOT_EXPORT) === 0) {
        continue;
      }
      if (sget(store, 'amt', i, id) <= 0) {
        continue;
      }
      out.push({ id, slot: i, since: sget(store, 'since', i, id), cargo });
    }
  }
  out.sort((a, b) => a.since - b.since || a.id - b.id || a.slot - b.slot);
  return out;
}

// One direction's flow bookkeeping: remaining budgets, per-link cost and
// budget-share totals, and the cached budget tree (null = rebuild).
export interface DirFlow {
  budgets: number[];
  flows: number[];
  shares: number[];
  // Cargo milli carried over each link this cycle (snapshot volume).
  vol: number[];
  tree: BudgetTree | null;
}

export function newFlow(fullBudgets: readonly number[], linkCount: number): DirFlow {
  return {
    budgets: [...fullBudgets],
    flows: new Array<number>(linkCount).fill(0),
    shares: new Array<number>(linkCount).fill(0),
    vol: new Array<number>(linkCount).fill(0),
    tree: null,
  };
}

export function flowTree(f: DirFlow, topo: FactionTopo, inbound: boolean): BudgetTree {
  return (f.tree ??= buildBudgetTree(topo, f.budgets, inbound));
}

function afterCharge(f: DirFlow, payer: number): void {
  if ((f.budgets[payer] ?? 0) <= 0) {
    f.tree = null;
  }
}

// Charge a link traversal to the paying node; the share is the charge as
// a fraction of that payer's full budget (clamped to 10000 bp).
export function chargeLink(
  f: DirFlow,
  fullBudgets: readonly number[],
  payer: number,
  link: number,
  t: number,
  q: number,
): void {
  f.budgets[payer] = (f.budgets[payer] ?? 0) - t;
  f.flows[link] = (f.flows[link] ?? 0) + t;
  f.vol[link] = (f.vol[link] ?? 0) + q;
  const full = fullBudgets[payer] ?? 0;
  if (full > 0) {
    f.shares[link] = Math.min(10000, (f.shares[link] ?? 0) + floorDiv(t * 10000, full));
  }
  afterCharge(f, payer);
}

// Last-mile charge: no link, but the payer can still saturate.
export function chargeLastMile(f: DirFlow, node: number, t: number): void {
  f.budgets[node] = (f.budgets[node] ?? 0) - t;
  afterCharge(f, node);
}

// Per-link bp shares plus saturation flags: a direction is saturated when
// its payer ended the cycle within 1% of full budget and the link carried
// flow that way. Payer convention matches treePath: outbound pays the
// upstream (nearer) end, inbound the far end; distance ties resolve to a.
export function utilization(
  f: DirFlow,
  topo: FactionTopo,
  full: BudgetTree,
  fullBudgets: readonly number[],
  inbound: boolean,
): { bp: number[]; sat: number[] } {
  const payerOf = (l: { a: number; b: number }): number => {
    const dA = full.dist[l.a] ?? INF;
    const dB = full.dist[l.b] ?? INF;
    const nearerIsA = dA <= dB;
    return inbound ? (nearerIsA ? l.b : l.a) : nearerIsA ? l.a : l.b;
  };
  const sat = topo.links.map((l, i) => {
    const payer = payerOf(l);
    const fullBudget = fullBudgets[payer] ?? 0;
    return (f.flows[i] ?? 0) > 0 && fullBudget > 0 && (f.budgets[payer] ?? 0) * 100 <= fullBudget
      ? 1
      : 0;
  });
  return { bp: f.shares, sat };
}
