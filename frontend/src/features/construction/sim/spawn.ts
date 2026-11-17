// Entity spawn helpers shared by the commands and systems: sites,
// blueprints, salvage piles, plus the placement gate used both to accept
// a start and to report a waiting reason.
import type { ResolvedStructure } from '../../../content/index';
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import { floorDiv, handleId } from '../../../core/index';
import type { SpawnInit, SystemContext } from '../../../kernel/index';
import { Faction, InWorld, UnderConstruction } from '../../../kernel/index';
import {
  CARGO_SLOTS,
  CargoStore,
  EMPTY_CARGO,
  exportStoreInit,
  sget,
} from '../../logistics/sim/index';
import { Mover, Position } from '../../movement/sim/index';
import { Blueprint, Construction, MODE_BUILD, Salvage, Structure } from './components';
import type { ConstructionEnv } from './env';
import {
  footprintCells,
  freeReservation,
  placementRule,
  placementView,
  setFootprintBlocked,
} from './env';
import { checkFootprint, checkRange } from '../rules/index';

export type StructurePhase = 'site' | 'complete';

// Spawn a structure entity in one phase with all injected parts. Sites
// block their footprint immediately; complete structures do too (start
// structures and instant completion paths alike).
export function spawnStructure(
  env: ConstructionEnv,
  ctx: SystemContext,
  faction: FactionId,
  kind: ResolvedStructure,
  x: number,
  y: number,
  phase: StructurePhase,
): EntityHandle {
  const init: SpawnInit = [
    [Faction, { id: faction }],
    [InWorld],
    [Structure, { kind: kind.index, x, y }],
    ...env.parts.flatMap((p) => p(kind, x, y, phase, ctx.tick)),
    ...(phase === 'site'
      ? ([
          [UnderConstruction],
          [Construction, { progress: 0, total: kind.build?.timeTicks ?? 1, mode: MODE_BUILD }],
        ] as const)
      : []),
  ];
  const handle = ctx.spawn(init);
  setFootprintBlocked(env, kind, x, y, true);
  return handle;
}

// Spawn a blueprint (Faction + Blueprint only) and reserve its cells.
export function spawnBlueprint(
  env: ConstructionEnv,
  ctx: SystemContext,
  faction: FactionId,
  kind: ResolvedStructure,
  x: number,
  y: number,
): EntityHandle {
  const handle = ctx.spawn([
    [Faction, { id: faction }],
    [Blueprint, { kind: kind.index, x, y, activated: 0, orderTick: 0 }],
  ]);
  const id = handleId(handle);
  let map = env.reservations.get(faction);
  if (map === undefined) {
    map = new Map<number, number>();
    env.reservations.set(faction, map);
  }
  footprintCells(kind, x, y, (cell) => map.set(cell, id + 1), env.terrain.width);
  return handle;
}

// Any mover's Position inside the footprint rect blocks placement and
// blueprint starts. Blueprints create no blockers themselves.
export function moversInside(
  ctx: SystemContext,
  kind: ResolvedStructure,
  x: number,
  y: number,
): boolean {
  const pos = ctx.read(Position);
  const x1 = x + kind.footprint.w;
  const y1 = y + kind.footprint.h;
  for (const id of ctx.query([Mover, Position])) {
    const px = pos.x[id] ?? 0;
    const py = pos.y[id] ?? 0;
    if (px >= x && px < x1 && py >= y && py < y1) {
      return true;
    }
  }
  return false;
}

export type WaitingReason =
  'not_covered' | 'not_connected' | 'occupied' | 'reserved' | 'units_in_way' | 'terrain' | null;

// Can a build start here for this faction? Returns null when it can, or
// the first blocking reason (footprint, then range, then movers).
// `exceptId` ignores that blueprint's own reservation.
export function buildBlocker(
  env: ConstructionEnv,
  ctx: SystemContext,
  faction: FactionId,
  kind: ResolvedStructure,
  x: number,
  y: number,
  exceptId = -1,
): WaitingReason {
  const rule = placementRule(kind);
  const view = placementView(env, ctx, faction, exceptId);
  const fc = checkFootprint(rule, x, y, view);
  if (fc !== 'ok') {
    if (fc === 'occupied') {
      return 'occupied';
    }
    if (fc === 'reserved') {
      return 'reserved';
    }
    // out_of_bounds / terrain / uneven / needs_deposit all surface as
    // 'terrain' waiting reasons.
    return 'terrain';
  }
  const rc = checkRange(rule, x, y, view);
  if (rc !== 'ok') {
    return rc;
  }
  return moversInside(ctx, kind, x, y) ? 'units_in_way' : null;
}

// Refund slots for a cancelled site: every delivered site-slot amount.
export function siteRefund(ctx: SystemContext, id: number): { cargo: number; milli: number }[] {
  const out = new Map<number, number>();
  if (!ctx.has(CargoStore, id as EntityId)) {
    return [];
  }
  const store = ctx.read(CargoStore);
  for (let i = 0; i < CARGO_SLOTS; i++) {
    const amt = sget(store, 'amt', i, id);
    const cargo = sget(store, 'cargo', i, id);
    if (cargo !== EMPTY_CARGO && amt > 0) {
      out.set(cargo, (out.get(cargo) ?? 0) + amt);
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([cargo, milli]) => ({ cargo, milli }));
}

// Refund slots for a demolished building: build cost x salvageBp.
export function demolishRefund(kind: ResolvedStructure): { cargo: number; milli: number }[] {
  const bp = kind.build?.salvageBp ?? 0;
  return (kind.build?.cost ?? [])
    .map((c) => ({ cargo: c.cargo, milli: floorDiv(c.milli * bp, 10000) }))
    .filter((c) => c.milli > 0);
}

// Spawn a salvage pile: export slots carry the refund home. Skipped when
// the refund is all zero.
export function spawnSalvage(
  ctx: SystemContext,
  faction: FactionId,
  x: number,
  y: number,
  refunds: readonly { cargo: number; milli: number }[],
): EntityHandle | null {
  const nonzero = refunds.filter((r) => r.milli > 0).slice(0, CARGO_SLOTS);
  if (nonzero.length === 0) {
    return null;
  }
  return ctx.spawn([
    [Faction, { id: faction }],
    [InWorld],
    [Position, { x, y }],
    [Salvage],
    [CargoStore, exportStoreInit(nonzero, ctx.tick)],
  ]);
}

// Despawn a blueprint and release its cell reservation.
export function removeBlueprint(
  env: ConstructionEnv,
  ctx: SystemContext,
  id: number,
  handle: EntityHandle,
): void {
  const bp = ctx.read(Blueprint);
  const fac = ctx.read(Faction);
  const kind = env.db.structures.byIndex(bp.kind[id] ?? 0);
  if (kind !== undefined) {
    freeReservation(env, (fac.id[id] ?? 0) as FactionId, kind, bp.x[id] ?? 0, bp.y[id] ?? 0, id);
  }
  ctx.despawn(handle);
}
