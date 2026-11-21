// Snapshot channels and the construction inspector. Blueprints are
// faction-private: they only appear in the owner's channel and can
// only be inspected by the owner.
import type { ContentDb } from '../../../content/index';
import type { EntityId, FactionId } from '../../../core/index';
import { floorDiv } from '../../../core/index';
import type { SimBuilder, SystemContext, VisibilityQuery } from '../../../kernel/index';
import { Faction, InWorld } from '../../../kernel/index';
import { CARGO_SLOTS, CargoStore, sget } from '../../logistics/sim/index';
import { SLOT_SITE } from '../../logistics/protocol';
import { Position } from '../../movement/sim/index';
import {
  CONSTRUCTION_INSPECTOR_ID,
  SalvageChannel,
  StructuresChannel,
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_NAMES,
  STATE_OPERATIONAL,
  STATE_SITE,
  STATE_RUIN,
  STATE_WAITING,
} from '../protocol';
import type {
  ConstructionInspection,
  ConstructionSalvage,
  ConstructionSiteSlot,
  ConstructionStructures,
} from '../protocol';
import { Blueprint, Construction, MODE_DEMOLISH, Ruin, Salvage, Structure } from './components';
import type { ConstructionEnv } from './env';
import { buildBlocker } from './spawn';

// Structures-channel state for a Structure entity (blueprints have
// their own rows).
// Public state mapping shared with vision's memory channel (single
// implementation; exported via sim/index).
export function structureStateOf(ctx: SystemContext, id: number): number {
  if (ctx.has(Ruin, id as EntityId)) {
    return STATE_RUIN;
  }
  if (ctx.has(Construction, id as EntityId)) {
    return (ctx.read(Construction).mode[id] ?? 0) === MODE_DEMOLISH
      ? STATE_DEMOLISHING
      : STATE_SITE;
  }
  return STATE_OPERATIONAL;
}

// Any-cell check over an integer footprint rect.
function visibleRect(
  visible: VisibilityQuery,
  ctx: SystemContext,
  observer: FactionId,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      if (visible(ctx, observer, cx, cy)) {
        return true;
      }
    }
  }
  return false;
}

export function registerConstructionViews(
  builder: SimBuilder,
  env: ConstructionEnv,
  db: ContentDb,
  // Injected health readout (combat wires it); default full.
  healthBp?: (ctx: SystemContext, id: number) => number,
  // Injected observer visibility (vision wires it); default all-visible.
  visible?: VisibilityQuery,
): void {
  // Snapshot: own structures + own blueprints always; non-own
  // structures only while any footprint cell is visible to the
  // observer (fog memory covers the rest).
  builder.snapshotChannel(StructuresChannel, (ctx, observer) => {
    const fac = ctx.read(Faction);
    const bp = ctx.read(Blueprint);
    const st = ctx.read(Structure);
    const cons = ctx.read(Construction);
    const rows: { id: number; kind: number; x: number; y: number; state: number }[] = [];
    for (const id of ctx.query([Blueprint])) {
      if ((fac.id[id] ?? -1) === observer) {
        rows.push({
          id,
          kind: bp.kind[id] ?? 0,
          x: bp.x[id] ?? 0,
          y: bp.y[id] ?? 0,
          state: (bp.activated[id] ?? 0) === 1 ? STATE_WAITING : STATE_BLUEPRINT,
        });
      }
    }
    for (const id of ctx.query([Structure, InWorld])) {
      // Ruins carry no Faction — treat them as non-own (never bypass
      // the visibility gate on a recycled faction slot).
      const owner = ctx.has(Faction, id as EntityId) ? (fac.id[id] ?? -1) : -1;
      if (owner !== observer && visible !== undefined) {
        const kind = db.structures.byIndex(st.kind[id] ?? -1);
        const fp = kind?.footprint;
        const seen =
          fp !== undefined &&
          visibleRect(visible, ctx, observer, st.x[id] ?? 0, st.y[id] ?? 0, fp.w, fp.h);
        if (!seen) {
          continue;
        }
      }
      rows.push({
        id,
        kind: st.kind[id] ?? 0,
        x: st.x[id] ?? 0,
        y: st.y[id] ?? 0,
        state: structureStateOf(ctx, id),
      });
    }
    rows.sort((a, b) => a.id - b.id);
    const n = rows.length;
    const out: ConstructionStructures = {
      handles: new Float64Array(n),
      kind: new Uint16Array(n),
      x: new Uint16Array(n),
      y: new Uint16Array(n),
      faction: new Uint16Array(n),
      state: new Uint8Array(n),
      progressBp: new Uint16Array(n),
      hpBp: new Uint16Array(n),
    };
    rows.forEach((r, i) => {
      out.handles[i] = Number(ctx.handleOf(r.id as EntityId) ?? 0);
      out.kind[i] = r.kind;
      out.x[i] = r.x;
      out.y[i] = r.y;
      out.faction[i] = ctx.has(Faction, r.id as EntityId) ? (fac.id[r.id] ?? 0) : 0;
      out.state[i] = r.state;
      const total = cons.total[r.id] ?? 0;
      out.progressBp[i] =
        r.state === STATE_BLUEPRINT || r.state === STATE_WAITING || r.state === STATE_RUIN
          ? 0
          : r.state === STATE_OPERATIONAL || total <= 0
            ? 10000
            : Math.min(10000, floorDiv((cons.progress[r.id] ?? 0) * 10000, total));
      out.hpBp[i] =
        r.state === STATE_RUIN
          ? 0
          : r.state === STATE_BLUEPRINT || r.state === STATE_WAITING
            ? 10000
            : (healthBp?.(ctx, r.id) ?? 10000);
    });
    return out;
  });

  // Salvage piles are owner-only intel (M5 fog).
  builder.snapshotChannel(SalvageChannel, (ctx, observer) => {
    const pos = ctx.read(Position);
    const fac = ctx.read(Faction);
    const ids = ctx.query([Salvage, InWorld]).filter((id) => (fac.id[id] ?? -1) === observer);
    const out: ConstructionSalvage = {
      handles: new Float64Array(ids.length),
      x: new Float32Array(ids.length),
      y: new Float32Array(ids.length),
    };
    ids.forEach((id, i) => {
      out.handles[i] = Number(ctx.handleOf(id as EntityId) ?? 0);
      out.x[i] = pos.x[id] ?? 0;
      out.y[i] = pos.y[id] ?? 0;
    });
    return out;
  });

  // Inspector: state, progress, site required vs delivered, waiting
  // reason for activated blueprints.
  builder.inspector(CONSTRUCTION_INSPECTOR_ID, (ctx, id, observer) => {
    const fac = ctx.read(Faction);
    const bp = ctx.read(Blueprint);
    const st = ctx.read(Structure);
    const cons = ctx.read(Construction);
    if (ctx.has(Blueprint, id)) {
      if ((fac.id[id] ?? -1) !== observer) {
        return null; // blueprints are faction-private
      }
      const kind = db.structures.byIndex(bp.kind[id] ?? 0);
      const activated = (bp.activated[id] ?? 0) === 1;
      const waiting =
        activated && kind !== undefined
          ? buildBlocker(env, ctx, observer, kind, bp.x[id] ?? 0, bp.y[id] ?? 0, id)
          : null;
      return {
        state: activated ? STATE_NAMES[STATE_WAITING] : STATE_NAMES[STATE_BLUEPRINT],
        kind: kind?.id ?? 'unknown',
        x: bp.x[id] ?? 0,
        y: bp.y[id] ?? 0,
        progress: 0,
        total: 0,
        progressBp: 0,
        waiting,
      } satisfies ConstructionInspection;
    }
    if (!ctx.has(Structure, id)) {
      return null;
    }
    const kind = db.structures.byIndex(st.kind[id] ?? 0);
    const state = structureStateOf(ctx, id);
    const total = cons.total[id] ?? 0;
    const progress = cons.progress[id] ?? 0;
    const progressBp = total > 0 ? Math.min(10000, floorDiv(progress * 10000, total)) : 10000;
    const base = {
      state: STATE_NAMES[state] ?? 'operational',
      kind: kind?.id ?? 'unknown',
      x: st.x[id] ?? 0,
      y: st.y[id] ?? 0,
      progress,
      total,
      progressBp,
    };
    // Site: required vs delivered per build-cost cargo.
    if (state === STATE_SITE && ctx.has(CargoStore, id)) {
      const store = ctx.read(CargoStore);
      const slots: ConstructionSiteSlot[] = [];
      for (let i = 0; i < CARGO_SLOTS; i++) {
        if ((sget(store, 'flags', i, id) & SLOT_SITE) !== 0) {
          slots.push({
            cargo: sget(store, 'cargo', i, id),
            required: sget(store, 'cap', i, id),
            delivered: sget(store, 'amt', i, id),
          });
        }
      }
      return { ...base, slots } satisfies ConstructionInspection;
    }
    return base satisfies ConstructionInspection;
  });
}
