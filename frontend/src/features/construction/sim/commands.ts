// Command handlers: place, activate, cancel. Every command validates
// all of its inputs before mutating anything; invalid or foreign
// handles are skipped and an all-invalid batch rejects 'no_targets'.
import type { ContentDb, ResolvedStructure } from '../../../content/index';
import type { EntityHandle } from '../../../core/index';
import type { SimBuilder } from '../../../kernel/index';
import { Faction, InWorld } from '../../../kernel/index';
import { ActivateCommand, CancelCommand, PlaceCommand } from '../protocol';
import { checkFootprint, checkRange } from '../rules/index';
import { Blueprint, Construction, MODE_BUILD, MODE_DEMOLISH, Structure } from './components';
import type { ConstructionEnv } from './env';
import { placementRule, placementView } from './env';
import { cancelSite } from './lifecycle';
import { moversInside, removeBlueprint, spawnBlueprint, spawnStructure } from './spawn';

export function registerConstructionCommands(
  builder: SimBuilder,
  env: ConstructionEnv,
  db: ContentDb,
): void {
  builder.command(PlaceCommand, (ctx, payload, issuer) => {
    const kind = db.structures.byId(payload.kind);
    if (kind === undefined || kind.build === undefined) {
      ctx.reject('not_buildable');
      return;
    }
    const rule = placementRule(kind);
    const view = placementView(env, ctx, issuer);
    const fc = checkFootprint(rule, payload.x, payload.y, view);
    if (fc !== 'ok') {
      ctx.reject(fc);
      return;
    }
    if (!payload.blueprint) {
      const rc = checkRange(rule, payload.x, payload.y, view);
      if (rc !== 'ok') {
        ctx.reject(rc);
        return;
      }
      if (moversInside(ctx, kind, payload.x, payload.y)) {
        ctx.reject('units_in_way');
        return;
      }
      spawnStructure(env, ctx, issuer, kind, payload.x, payload.y, 'site');
    } else {
      spawnBlueprint(env, ctx, issuer, kind, payload.x, payload.y);
    }
  });

  builder.command(ActivateCommand, (ctx, payload, issuer) => {
    const bp = ctx.read(Blueprint);
    const fac = ctx.read(Faction);
    const targets: number[] = [];
    for (const h of new Set(payload.blueprints)) {
      const id = ctx.resolve(h as EntityHandle);
      if (
        id !== null &&
        ctx.has(Blueprint, id) &&
        (fac.id[id] ?? 0) === issuer &&
        (bp.activated[id] ?? 0) === 0
      ) {
        targets.push(id);
      }
    }
    if (targets.length === 0) {
      ctx.reject('no_targets');
      return;
    }
    const w = ctx.write(env.blueprintW);
    for (const id of targets) {
      w.activated[id] = 1;
      w.orderTick[id] = ctx.tick;
    }
  });

  builder.command(CancelCommand, (ctx, payload, issuer) => {
    const st = ctx.read(Structure);
    const fac = ctx.read(Faction);
    const cons = ctx.read(Construction);
    // Classify first, then mutate: nothing changes while validating.
    const blueprints: { id: number; handle: EntityHandle }[] = [];
    const sites: { id: number; handle: EntityHandle }[] = [];
    const demolish: { id: number; handle: EntityHandle; kind: ResolvedStructure }[] = [];
    for (const h of new Set(payload.targets)) {
      const handle = h as EntityHandle;
      const id = ctx.resolve(handle);
      if (id === null || (fac.id[id] ?? -1) !== issuer) {
        continue;
      }
      // A demolition already queued this tick: the component lands at
      // tick end, so without this set the same handle would classify as
      // finished again.
      if (env.pendingDemolish.has(id)) {
        continue;
      }
      if (ctx.has(Blueprint, id)) {
        blueprints.push({ id, handle });
        continue;
      }
      if (!ctx.has(Structure, id) || !ctx.has(InWorld, id)) {
        continue;
      }
      // Entities without Construction have no mode field at all —
      // do not read a default-0 array value as MODE_BUILD.
      const mode = ctx.has(Construction, id) ? (cons.mode[id] ?? 0) : -1;
      if (mode === MODE_DEMOLISH) {
        continue; // already being demolished: no-op for this handle
      }
      const kind = db.structures.byIndex(st.kind[id] ?? 0);
      if (kind === undefined || kind.build === undefined) {
        continue;
      }
      if (mode === MODE_BUILD) {
        sites.push({ id, handle });
      } else {
        demolish.push({ id, handle, kind });
      }
    }
    if (blueprints.length + sites.length + demolish.length === 0) {
      ctx.reject('no_targets');
      return;
    }
    for (const t of blueprints) {
      removeBlueprint(env, ctx, t.id, t.handle);
    }
    for (const t of sites) {
      cancelSite(env, db, ctx, t.id, t.handle);
    }
    for (const t of demolish) {
      env.pendingDemolish.add(t.id);
      ctx.addComponent(env.ucW, t.handle);
      ctx.addComponent(env.constructionW, t.handle, {
        progress: 0,
        total: t.kind.build?.demolishTicks ?? 1,
        mode: MODE_DEMOLISH,
      });
    }
  });
}
