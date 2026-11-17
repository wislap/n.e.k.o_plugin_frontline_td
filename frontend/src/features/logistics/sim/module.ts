// Logistics module (ADR 0025): per-tick intent resolution + site
// conversion, and the per-cycle allocation (rates, outbound, reserves,
// inbound, supply-state modifiers, utilization — see cycle.ts). Topology
// is derived state, rebuilt lazily when the completed node set changes,
// when terrain blockers change (wired by the app) or on load.
import type { ContentDb } from '../../../content/index';
import type { EntityId, FactionId, Serializable } from '../../../core/index';
import { MILLI, floorDiv } from '../../../core/index';
import { defineGridLayer } from '../../../kernel/index';
import type {
  ComponentWriter,
  GridLayerWriter,
  SimModule,
  SystemContext,
} from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import {
  ADJUSTABLE_CLASSES,
  LogisticsNetworkChannel,
  SERVICE_LAYER_ID,
  SetPrioritiesCommand,
  UNMET_REASONS,
  cargoClassCode,
} from '../protocol';
import type { CargoClassName } from '../protocol';
import { attachOf, bestSiteLink, collectNodeIds, nodeListOf, rebuildTopo } from './attach';
import { runCycle } from './cycle';
import { registerResolve } from './resolve';
import {
  RoadLayer,
  linkPath as linkPathQuery,
  loadRoads,
  mirrorRoads,
  paveRoads,
  refreshMultipliers,
  saveRoads,
} from './roads';
import type { LinkPath } from './roads';
import {
  CARGO_SLOTS,
  CargoStore,
  EnergyEmptyModifier,
  EnergyLowModifier,
  SiteStore,
} from './components';
import type { FactionState, LogisticsEnv } from './env';
import type { CargoFields, ModWriter } from './slots';
import { sget } from './slots';
import type { FactionTopo, TopoNode } from './topology';
import { inspectLogistics, networkSnapshot } from './views';

const ServiceLayer = defineGridLayer(SERVICE_LAYER_ID, 'u8', { perFaction: true });

const GROUND_CLASS_ID = 'frontline_td:ground';
const ENERGY_ID = 'frontline_td:energy';
const UNMET_COUNT = UNMET_REASONS.length;

export interface LogisticsStart {
  faction: FactionId;
  // cargo index -> stock in units (converted to milli on start).
  stock?: ReadonlyMap<number, number>;
}

export interface LogisticsOptions {
  // Injected health-band source (combat wires it in batch C).
  healthBp?: (ctx: SystemContext, id: EntityId) => number;
  starts?: readonly LogisticsStart[];
}

export interface LogisticsModule extends SimModule {
  // Wired by the app to terrain.onBlockedChange (ADR 0030): unblocking
  // dirties every faction; blocking dirties only factions whose
  // sensitive set (link polylines + node rings) intersects the cells.
  blockersChanged(cells: readonly { x: number; y: number }[], blocked: boolean): void;
  // Read-only queries for other features (safe inside commands).
  // True when cell x,y is inside the faction's service coverage.
  covered(ctx: SystemContext, faction: FactionId, x: number, y: number): boolean;
  // Would a node with this top-left footprint/connect link to a
  // completed own node (same ring-distance rule as topology links)?
  connectsToNetwork(
    ctx: SystemContext,
    faction: FactionId,
    footprint: { x: number; y: number; w: number; h: number },
    connect: number,
  ): boolean;
  // Energy fill bp across the entity's CargoStore (−1 = no energy slot).
  energyBp(ctx: SystemContext, id: EntityId): number;
  // Pave cells at `level` in the road layer (never lowers a level).
  pave(cells: readonly { x: number; y: number }[], level: number): void;
  // The link between two node handles, oriented upstream -> downstream
  // with per-cell cumulative cost (null when not linked).
  linkPath(ctx: SystemContext, faction: FactionId, a: number, b: number): LinkPath | null;
}

export function createLogisticsModule(
  db: ContentDb,
  terrain: TerrainApi,
  options: LogisticsOptions = {},
): LogisticsModule {
  const cargoCount = db.cargos.list.length;
  const states = new Map<number, FactionState>();
  function stateOf(faction: number): FactionState {
    let s = states.get(faction);
    if (s === undefined) {
      s = {
        stock: new Array<number>(cargoCount).fill(0),
        priorities: ADJUSTABLE_CLASSES.map((c) => cargoClassCode(c)),
        unmet: new Array<number>(UNMET_COUNT).fill(0),
        unmetExport: new Array<number>(UNMET_COUNT).fill(0),
        outBp: [],
        inBp: [],
        outSat: [],
        inSat: [],
        quotaOut: [],
        quotaIn: [],
        volOut: [],
        volIn: [],
        intercept: [],
      };
      states.set(faction, s);
    }
    return s;
  }

  const topos = new Map<number, FactionTopo>();
  const topoNodeIds = new Map<number, number[]>();
  let topoAllDirty = true;
  const topoDirtyFactions = new Set<number>();

  let env: LogisticsEnv;

  return {
    id: 'frontline_td:logistics',
    blockersChanged(cells, blocked) {
      if (!blocked) {
        topoAllDirty = true;
        return;
      }
      for (const [f, topo] of topos) {
        for (const c of cells) {
          if ((topo.sensitive[c.y * terrain.width + c.x] ?? 0) !== 0) {
            topoDirtyFactions.add(f);
            break;
          }
        }
      }
    },
    covered(ctx, faction, x, y) {
      if (!terrain.inBounds(x, y)) {
        return false;
      }
      return (ctx.layer(env.layerW.layer, faction)[y * terrain.width + x] ?? 0) !== 0;
    },
    connectsToNetwork(ctx, faction, footprint, connect) {
      const ids = collectNodeIds(ctx, faction);
      if (ids.length === 0) {
        return false;
      }
      const site: TopoNode = {
        id: -1,
        x: footprint.x + footprint.w / 2,
        y: footprint.y + footprint.h / 2,
        connect,
        service: 0,
        vehicles: 0,
        warehouse: false,
        w: footprint.w,
        h: footprint.h,
      };
      return bestSiteLink(nodeListOf(ctx, ids), site, terrain, env.groundCls) !== null;
    },
    energyBp(ctx, id) {
      if (!ctx.has(CargoStore, id)) {
        return -1;
      }
      const store = ctx.read(CargoStore);
      let amt = 0;
      let cap = 0;
      for (let i = 0; i < CARGO_SLOTS; i++) {
        if (sget(store, 'cargo', i, id) === env.energyIdx) {
          amt += sget(store, 'amt', i, id);
          cap += sget(store, 'cap', i, id);
        }
      }
      if (cap === 0) {
        return -1;
      }
      return Math.min(10000, floorDiv(amt * 10000, cap));
    },
    pave(cells, level) {
      paveRoads(env, cells, level);
    },
    linkPath(ctx, faction, a, b) {
      return linkPathQuery(env, ctx, faction, a, b);
    },
    install(builder) {
      const cargoW: ComponentWriter<CargoFields> = builder.claimWriter(CargoStore);
      const siteW: ComponentWriter<{ kind: 'u16' }> = builder.claimWriter(SiteStore);
      const lowW: ModWriter = builder.claimWriter(EnergyLowModifier);
      const emptyW: ModWriter = builder.claimWriter(EnergyEmptyModifier);
      const layerW: GridLayerWriter = builder.claimLayerWriter(ServiceLayer);
      const roadW: GridLayerWriter = builder.claimLayerWriter(RoadLayer);

      env = {
        db,
        cfg: db.logistics,
        groundCls: db.movementClasses.byId(GROUND_CLASS_ID)?.index ?? 0,
        energyIdx: db.cargos.byId(ENERGY_ID)?.index ?? -1,
        dirt: db.logistics.roadLevels[0]?.multiplierBp ?? 10000,
        terrain,
        healthBp: options.healthBp ?? (() => 10000),
        cargoW,
        siteW,
        lowW,
        emptyW,
        layerW,
        topos,
        topoNodeIds,
        stateOf,
        attachOf: (ctx, topo, id, px, py) => attachOf(env, ctx, topo, id, px, py),
        roads: new Uint8Array(terrain.width * terrain.height),
        roadVersion: 0,
        roadDirty: false,
        roadW,
        roadMult: db.logistics.roadLevels.map((l) => l.multiplierBp),
      };

      builder.onStart(() => {
        for (const start of options.starts ?? []) {
          const s = stateOf(start.faction);
          for (const [cargo, units] of start.stock ?? new Map<number, number>()) {
            s.stock[cargo] = units * MILLI;
          }
        }
      });

      builder.state('frontline_td:logistics.state', {
        save() {
          const out: Record<string, unknown> = {};
          for (const [fid, s] of [...states.entries()].sort((a, b) => a[0] - b[0])) {
            out[String(fid)] = {
              stock: s.stock,
              priorities: s.priorities,
              unmet: s.unmet,
              unmetExport: s.unmetExport,
              outBp: s.outBp,
              inBp: s.inBp,
              outSat: s.outSat,
              inSat: s.inSat,
              quotaOut: s.quotaOut,
              quotaIn: s.quotaIn,
              volOut: s.volOut,
              volIn: s.volIn,
              intercept: s.intercept,
            };
          }
          return out as Serializable;
        },
        load(data) {
          states.clear();
          const record = data as unknown as Record<string, FactionState>;
          for (const [fid, raw] of Object.entries(record)) {
            states.set(Number(fid), {
              stock: [...raw.stock],
              priorities: [...raw.priorities],
              unmet: [...raw.unmet],
              unmetExport: [...raw.unmetExport],
              outBp: [...raw.outBp],
              inBp: [...raw.inBp],
              outSat: [...raw.outSat],
              inSat: [...raw.inSat],
              quotaOut: [...raw.quotaOut],
              quotaIn: [...raw.quotaIn],
              volOut: [...raw.volOut],
              volIn: [...raw.volIn],
              intercept: [...raw.intercept],
            });
          }
          topoAllDirty = true;
        },
      });

      builder.state('frontline_td:logistics.roads', {
        save: () => saveRoads(env),
        load: (data) => {
          loadRoads(env, data);
          topoAllDirty = true;
        },
      });

      // Road changes may land in any phase (construction runs late), so
      // the layer mirror runs in the last phase — same reason as terrain.
      builder.system({
        id: 'frontline_td:logistics.mirror_roads',
        phase: 'capture_fog',
        run(ctx) {
          mirrorRoads(env, ctx);
        },
      });

      // Per-tick resolution first: consume/deposit intents, then site
      // conversion. Registered before the cycle system so it runs first in
      // the logistics phase.
      registerResolve(builder, env, db);

      builder.system({
        id: 'frontline_td:logistics.allocate',
        phase: 'logistics',
        everyTicks: env.cfg.cycleTicks,
        offset: 0,
        run(ctx) {
          for (const f of ctx.factions()) {
            const ids = collectNodeIds(ctx, f);
            const prev = topoNodeIds.get(f);
            const changed =
              topoAllDirty ||
              topoDirtyFactions.has(f) ||
              prev === undefined ||
              prev.length !== ids.length ||
              prev.some((v, i) => v !== ids[i]);
            if (changed) {
              rebuildTopo(env, ctx, f, ids);
            }
          }
          topoAllDirty = false;
          topoDirtyFactions.clear();
          for (const topo of topos.values()) {
            refreshMultipliers(env, topo);
          }
          for (const f of ctx.factions()) {
            runCycle(env, ctx, f);
          }
        },
      });

      builder.command(SetPrioritiesCommand, (ctx, payload, issuer) => {
        const want: readonly string[] = payload.order;
        const all = new Set<string>(ADJUSTABLE_CLASSES);
        const seen = new Set<string>();
        let ok = want.length === all.size;
        for (const c of want) {
          if (!all.has(c) || seen.has(c)) {
            ok = false;
          }
          seen.add(c);
        }
        if (!ok || seen.size !== all.size) {
          ctx.reject('invalid_order');
          return;
        }
        stateOf(issuer).priorities = want.map((c) => cargoClassCode(c as CargoClassName));
      });

      builder.inspector('frontline_td:logistics', (ctx, id) => inspectLogistics(env, ctx, id));

      builder.snapshotChannel(LogisticsNetworkChannel, (ctx, observer) =>
        networkSnapshot(env, ctx, observer),
      );
    },
  };
}
