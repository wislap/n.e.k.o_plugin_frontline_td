// Construction module (ADR 0012): blueprint reservation, site spawning,
// build/demolish progress, cancellation refunds and salvage. All commands
// validate fully before mutating. The module claims the kernel
// UnderConstruction writer — operational systems exclude those entities.
import type { ContentDb } from '../../../content/index';
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import type { SimModule, SystemContext, VisibilityQuery } from '../../../kernel/index';
import { Faction, UnderConstruction } from '../../../kernel/index';
import { CaptureCompleted } from '../../capture/protocol';
import { CombatDied } from '../../combat/protocol';
import { CARGO_SLOTS, CargoStore, sget } from '../../logistics/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import type { FactionStart } from '../../units/sim/index';
import { ConstructionCompleted } from '../protocol';
import {
  Blueprint,
  Construction,
  Core,
  MODE_BUILD,
  RoadSegment,
  Ruin,
  Structure,
} from './components';
import { registerConstructionCommands } from './commands';
import type {
  ConstructionEnv,
  LogisticsQueries,
  RoadSegmentPartsFn,
  RuinPartsFn,
  StructurePartsFn,
} from './env';
import { loadReservations, saveReservations, setFootprintBlocked } from './env';
import { finishDemolition, startSite } from './lifecycle';
import { endProjectOfSegment, registerRoads } from './roads';
import { buildBlocker, deliveredAllowed, spawnRuin, spawnStructure } from './spawn';
import { Salvage } from './components';
import { registerConstructionViews } from './views';

export interface ConstructionOptions {
  structureParts: readonly StructurePartsFn[];
  // Injected road-segment parts (logistics site slots + FixedAttach,
  // combat Health + Targetable); default none.
  segmentParts?: readonly RoadSegmentPartsFn[];
  // Injected health readout (combat wires it); default full.
  healthBp?: (ctx: SystemContext, id: number) => number;
  // Injected ruin parts (capture progress); default none.
  ruinParts?: readonly RuinPartsFn[];
  // Injected observer visibility filter for the structures channel
  // (vision wires it); default all-visible.
  visible?: VisibilityQuery;
  starts?: readonly FactionStart[];
}

export function createConstructionModule(
  db: ContentDb,
  terrain: TerrainApi,
  logistics: LogisticsQueries,
  options: ConstructionOptions,
): SimModule {
  let env: ConstructionEnv;

  return {
    id: 'frontline_td:construction',
    install(builder) {
      env = {
        db,
        terrain,
        logistics,
        parts: options.structureParts,
        groundCls: db.movementClasses.byId('frontline_td:ground')?.index ?? 0,
        structureW: builder.claimWriter(Structure),
        constructionW: builder.claimWriter(Construction),
        blueprintW: builder.claimWriter(Blueprint),
        ucW: builder.claimWriter(UnderConstruction),
        coreW: builder.claimWriter(Core),
        reservations: new Map(),
        pendingDemolish: new Set(),
        projects: new Map(),
        nextProjectId: 1,
        segmentParts: options.segmentParts ?? [],
        ruinParts: options.ruinParts ?? [],
      };

      // Per-tick bookkeeping: commands run before systems in the command
      // phase, so this clear lands after the tick's commands and the set
      // only ever covers one tick's cancel batches.
      builder.system({
        id: 'frontline_td:construction.tick_state',
        phase: 'command',
        run() {
          env.pendingDemolish.clear();
        },
      });

      builder.state('frontline_td:construction.reservations', {
        save: () => saveReservations(env),
        load: (data) => {
          loadReservations(env, data);
        },
      });

      // Start structures spawn complete before units' onStart (the app
      // installs construction first); they block their footprints so the
      // unit spiral skips those cells.
      builder.onStart((ctx) => {
        for (const start of options.starts ?? []) {
          for (const s of start.structures ?? []) {
            const kind = db.structures.byIndex(s.kind);
            if (kind !== undefined) {
              spawnStructure(env, ctx, start.faction, kind, s.x, s.y, 'complete');
            }
          }
        }
      });

      // Every tick: build progress capped by delivered materials;
      // demolition progress flat.
      builder.system({
        id: 'frontline_td:construction.progress',
        phase: 'construction',
        emits: [ConstructionCompleted],
        run(ctx) {
          const cons = ctx.write(env.constructionW);
          const consR = ctx.read(Construction);
          for (const id of ctx.query([Construction, Structure])) {
            const total = consR.total[id] ?? 1;
            const handle = ctx.handleOf(id as EntityId);
            if (handle === null) {
              continue;
            }
            if ((consR.mode[id] ?? 0) === MODE_BUILD) {
              const allowed = deliveredAllowed(ctx, id, total);
              const next = Math.min((consR.progress[id] ?? 0) + 1, allowed);
              cons.progress[id] = next;
              if (next >= total) {
                ctx.removeComponent(env.ucW, handle);
                ctx.removeComponent(env.constructionW, handle);
                const st = ctx.read(Structure);
                // Core flags arrive with operational status.
                const coreKind = db.structures.byIndex(st.kind[id] ?? 0);
                if (coreKind?.core === true) {
                  ctx.addComponent(env.coreW, handle);
                }
                ctx.emit(ConstructionCompleted, {
                  handle: Number(handle),
                  kind: st.kind[id] ?? 0,
                  issuer: ctx.read(Faction).id[id] ?? 0,
                });
              }
            } else {
              const next = (consR.progress[id] ?? 0) + 1;
              cons.progress[id] = next;
              if (next >= total) {
                finishDemolition(env, db, ctx, id, handle);
              }
            }
          }
        },
      });

      // Every logistics cycle (this phase runs after logistics): try to
      // start activated blueprints in (orderTick, entity id) order.
      builder.system({
        id: 'frontline_td:construction.activate',
        phase: 'construction',
        everyTicks: db.logistics.cycleTicks,
        offset: 0,
        run(ctx) {
          const bp = ctx.read(Blueprint);
          const waiting = ctx.query([Blueprint]).filter((id) => (bp.activated[id] ?? 0) === 1);
          waiting.sort((a, b) => (bp.orderTick[a] ?? 0) - (bp.orderTick[b] ?? 0) || a - b);
          for (const id of waiting) {
            const kind = db.structures.byIndex(bp.kind[id] ?? 0);
            const handle = ctx.handleOf(id as EntityId);
            if (kind === undefined || handle === null) {
              continue;
            }
            const fac = ctx.read(Faction);
            const blocker = buildBlocker(
              env,
              ctx,
              (fac.id[id] ?? 0) as FactionId,
              kind,
              bp.x[id] ?? 0,
              bp.y[id] ?? 0,
              id,
            );
            if (blocker === null) {
              startSite(env, db, ctx, id, handle);
            }
          }
        },
      });

      // Every cycle: empty salvage piles despawn (shipped home or never
      // covered by the network).
      builder.system({
        id: 'frontline_td:construction.salvage_gc',
        phase: 'construction',
        everyTicks: db.logistics.cycleTicks,
        offset: 0,
        run(ctx) {
          const store = ctx.read(CargoStore);
          for (const id of ctx.query([Salvage, CargoStore])) {
            let empty = true;
            for (let i = 0; i < CARGO_SLOTS; i++) {
              if (sget(store, 'amt', i, id) > 0) {
                empty = false;
              }
            }
            const handle = ctx.handleOf(id as EntityId);
            if (empty && handle !== null) {
              ctx.despawn(handle);
            }
          }
        },
      });

      // Dead structures free their footprint before combat's despawn
      // runs (construction installs before combat, so this cleanup-phase
      // system observes combat.died first). Nothing else is dropped:
      // ruins and salvage-on-death are deferred.
      builder.system({
        id: 'frontline_td:construction.free_dead',
        phase: 'cleanup',
        reads: [CombatDied],
        run(ctx) {
          const st = ctx.read(Structure);
          for (const p of ctx.read(CombatDied)) {
            const id = ctx.resolve(p.handle as EntityHandle);
            if (id === null) {
              continue;
            }
            // Destroyed road segment: its materials are lost and the
            // project ends; paved cells stay paved.
            if (ctx.has(RoadSegment, id)) {
              endProjectOfSegment(env, ctx, id);
            }
            if (!ctx.has(Structure, id)) {
              continue;
            }
            const kind = db.structures.byIndex(st.kind[id] ?? 0);
            if (kind === undefined) {
              continue;
            }
            // Capture structures (outposts) collapse into ruins: the
            // footprint stays blocked and ownership resets to nobody.
            if (kind.capture !== undefined) {
              spawnRuin(env, ctx, kind, st.x[id] ?? 0, st.y[id] ?? 0);
              continue;
            }
            setFootprintBlocked(env, kind, st.x[id] ?? 0, st.y[id] ?? 0, false);
          }
        },
      });

      // A completed capture despawns the ruin and replaces it with a
      // fresh site for the captor (capture never rewrites Faction).
      builder.system({
        id: 'frontline_td:construction.capture_rebuild',
        phase: 'construction',
        reads: [CaptureCompleted],
        run(ctx) {
          const st = ctx.read(Structure);
          for (const p of ctx.read(CaptureCompleted)) {
            const id = ctx.resolve(p.ruin as EntityHandle);
            if (id === null || !ctx.has(Ruin, id)) {
              continue;
            }
            const kind = db.structures.byIndex(p.kind);
            if (kind === undefined || kind.capture === undefined) {
              continue;
            }
            ctx.despawn(ctx.handleOf(id) as EntityHandle);
            spawnStructure(
              env,
              ctx,
              p.faction as FactionId,
              kind,
              st.x[id] ?? 0,
              st.y[id] ?? 0,
              'site',
              kind.capture.rebuildTicks,
            );
          }
        },
      });

      registerConstructionCommands(builder, env, db);
      registerRoads(builder, env, db, options.healthBp);
      registerConstructionViews(builder, env, db, options.healthBp, options.visible);
    },
  };
}
