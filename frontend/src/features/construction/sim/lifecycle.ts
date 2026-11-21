// Entity lifecycle shared by the module's systems and the cancel
// command: blueprint -> site conversion, site cancel refund and
// demolition completion.
import type { ContentDb } from '../../../content/index';
import type { EntityHandle, FactionId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import { Blueprint, Structure } from './components';
import type { ConstructionEnv } from './env';
import { setFootprintBlocked } from './env';
import { demolishRefund } from '../rules/index';
import { removeBlueprint, siteRefund, spawnSalvage, spawnStructure } from './spawn';

// Start a site's build for a blueprint: move its reservation to
// occupancy, spawn the site entity, despawn the blueprint.
export function startSite(
  env: ConstructionEnv,
  db: ContentDb,
  ctx: SystemContext,
  id: number,
  handle: EntityHandle,
): void {
  const bp = ctx.read(Blueprint);
  const fac = ctx.read(Faction);
  const kind = db.structures.byIndex(bp.kind[id] ?? 0);
  if (kind === undefined) {
    return;
  }
  const faction = (fac.id[id] ?? 0) as FactionId;
  const x = bp.x[id] ?? 0;
  const y = bp.y[id] ?? 0;
  removeBlueprint(env, ctx, id, handle);
  spawnStructure(env, ctx, faction, kind, x, y, 'site');
}

// Finish a demolition: free the footprint, spawn the salvage refund,
// despawn the building.
export function finishDemolition(
  env: ConstructionEnv,
  db: ContentDb,
  ctx: SystemContext,
  id: number,
  handle: EntityHandle,
): void {
  const st = ctx.read(Structure);
  const fac = ctx.read(Faction);
  const pos = ctx.read(Position);
  const kind = db.structures.byIndex(st.kind[id] ?? 0);
  if (kind !== undefined) {
    setFootprintBlocked(env, kind, st.x[id] ?? 0, st.y[id] ?? 0, false);
    spawnSalvage(
      ctx,
      (fac.id[id] ?? 0) as FactionId,
      pos.x[id] ?? 0,
      pos.y[id] ?? 0,
      demolishRefund(kind),
    );
  }
  ctx.despawn(handle);
}

// Refund pile for a cancelled build site (delivered materials only).
export function cancelSite(
  env: ConstructionEnv,
  db: ContentDb,
  ctx: SystemContext,
  id: number,
  handle: EntityHandle,
): void {
  const st = ctx.read(Structure);
  const fac = ctx.read(Faction);
  const pos = ctx.read(Position);
  const kind = db.structures.byIndex(st.kind[id] ?? 0);
  if (kind !== undefined) {
    setFootprintBlocked(env, kind, st.x[id] ?? 0, st.y[id] ?? 0, false);
    spawnSalvage(
      ctx,
      (fac.id[id] ?? 0) as FactionId,
      pos.x[id] ?? 0,
      pos.y[id] ?? 0,
      siteRefund(ctx, id),
    );
  }
  ctx.despawn(handle);
}
