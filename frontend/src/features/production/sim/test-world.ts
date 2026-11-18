// Shared production test harness: flat ASCII grid, a wired world
// (terrain + pathing + movement + logistics + construction + production)
// with the real structureParts injection, plus command/event helpers.
import type { ContentDb, ResolvedStructure } from '../../../content/index';
import { loadContent } from '../../../content/index';
import { contentId, toFactionId, toTick } from '../../../core/index';
import { COMMAND_REJECTED } from '../../../core/index';
import type {
  CommandEnvelope,
  CommandRejectedPayload,
  EntityHandle,
  FactionId,
  Serializable,
} from '../../../core/index';
import { Faction, InWorld, createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule, SpawnInit } from '../../../kernel/index';
import type { ResolvedSurface } from '../../../content/index';
import { createTerrainModule } from '../../terrain/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createMovementModule } from '../../movement/sim/index';
import {
  createLogisticsModule,
  structureParts as logisticsStructureParts,
} from '../../logistics/sim/index';
import { createConstructionModule, Structure } from '../../construction/sim/index';
import type { FactionStart } from '../../units/sim/index';
import { structureParts as productionStructureParts } from './parts';
import { createProductionModule } from './module';
import { createUnitsModule } from '../../units/sim/index';
import { unitParts as logisticsUnitParts } from '../../logistics/sim/index';
import { makeGrid, must } from '../../../testing/index';

const DB: ContentDb = loadContent();
export const F1 = toFactionId(1);
export const CYCLE = DB.logistics.cycleTicks;
export const MATERIAL = DB.cargos.byId('frontline_td:material')?.index ?? -1;
export const ENERGY = DB.cargos.byId('frontline_td:energy')?.index ?? -1;
export const ORE = DB.cargos.byId('frontline_td:ore')?.index ?? -1;

export const MINER = must(DB.structures.byId('frontline_td:miner'), 'miner');
export const FACTORY = must(DB.structures.byId('frontline_td:ammo_factory'), 'ammo_factory');

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
];

type PartPatch = (comp: unknown, init: Record<string, number>) => Record<string, number>;

// A completed structure entity: marker + logistics + production parts.
export function structureInit(
  kind: ResolvedStructure,
  x: number,
  y: number,
  patch?: PartPatch,
): SpawnInit {
  const parts: SpawnInit = [
    [Structure, { kind: kind.index, x, y }],
    ...logisticsStructureParts(kind, x, y, 'complete', 0),
    ...productionStructureParts(kind),
  ];
  if (patch === undefined) {
    return parts;
  }
  return parts.map(([comp, init]) => [
    comp,
    patch(comp, { ...(init ?? {}) } as Record<string, number>),
  ]);
}

interface TestEnt {
  parts: SpawnInit;
  faction?: number;
}

export interface WorldOpts {
  rows: string[];
  entities?: readonly TestEnt[];
  starts?: readonly FactionStart[];
  factions?: readonly number[];
  // Install the units module so units.spawn intents resolve.
  withUnits?: boolean;
  extraModules?: readonly SimModule[];
}

export interface BuiltWorld {
  config: SimConfig;
  modules: SimModule[];
  sim: ReturnType<typeof createSimulation>;
  handles: EntityHandle[];
  issue(type: string, payload: Serializable, issuer?: FactionId): void;
  // Reject reasons recorded for the issuer since the last call.
  rejections(issuer?: FactionId): string[];
  // Total amount of `cargo` (registry index) in entity i's store (F1-owned).
  storeAmount(i: number, cargo: number): number;
  inspect(i: number, section: string): Record<string, unknown> | null;
  open(): ReturnType<typeof createSimulation>;
  attach(s: ReturnType<typeof createSimulation>): void;
}

function buildWorld(opts: WorldOpts): BuiltWorld {
  const grid = makeGrid(opts.rows);
  const terrain = createTerrainModule(grid, SURFACES);
  const pathing = createPathingModule(terrain.api, 1);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  const logistics = createLogisticsModule(DB, terrain.api, { starts: opts.starts ?? [] });
  terrain.api.onBlockedChange((cells, blocked) => {
    logistics.blockersChanged(cells, blocked);
  });
  const construction = createConstructionModule(DB, terrain.api, logistics, {
    structureParts: [logisticsStructureParts, productionStructureParts],
    starts: opts.starts ?? [],
  });
  const production = createProductionModule(DB);

  const handles: EntityHandle[] = [];
  const spawner: SimModule = {
    id: 'frontline_td:test.spawn',
    install(builder) {
      builder.onStart((ctx) => {
        for (const ent of opts.entities ?? []) {
          handles.push(ctx.spawn([[Faction, { id: ent.faction ?? 1 }], [InWorld], ...ent.parts]));
        }
      });
    },
  };

  const factions = (opts.factions ?? [1]).map((f) => ({ id: toFactionId(f) }));
  const config: SimConfig = {
    seed: 7,
    factions,
    relations: [],
    grid: { width: grid.width, height: grid.height },
    rngStreams: [],
    controllers: [],
  };
  const modules: SimModule[] = [
    terrain.module,
    pathing.module,
    movement,
    logistics,
    construction,
    production,
    ...(opts.withUnits === true
      ? [createUnitsModule(DB, terrain.api, opts.starts ?? [], [logisticsUnitParts])]
      : []),
    spawner,
    ...(opts.extraModules ?? []),
  ];
  let sim: ReturnType<typeof createSimulation> | null = null;
  return {
    config,
    modules,
    handles,
    get sim() {
      return sim as ReturnType<typeof createSimulation>;
    },
    issue(type, payload, issuer = F1) {
      const s = sim as ReturnType<typeof createSimulation>;
      const envelope: CommandEnvelope = {
        tick: toTick(s.tick + 1),
        issuer,
        type,
        payload,
      };
      s.submit(envelope);
    },
    rejections(issuer = F1) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s
        .snapshot(issuer)
        .events.filter((e) => e.type === COMMAND_REJECTED.type)
        .map((e) => (e.payload as CommandRejectedPayload).reason);
    },
    storeAmount(i, cargo) {
      const s = sim as ReturnType<typeof createSimulation>;
      const out = s.inspect(F1, handles[i] ?? (0 as EntityHandle));
      const section = out?.sections['frontline_td:logistics'] as
        { slots?: { cargo: string; amount: number }[] } | null | undefined;
      const wanted = DB.cargos.byIndex(cargo)?.id;
      const row = (section?.slots ?? []).find((slot) => slot.cargo === wanted);
      return row?.amount ?? 0;
    },
    inspect(i, section) {
      const s = sim as ReturnType<typeof createSimulation>;
      const out = s.inspect(F1, handles[i] ?? (0 as EntityHandle));
      return (out?.sections[section] ?? null) as Record<string, unknown> | null;
    },
    open() {
      sim = createSimulation(config, modules);
      return sim;
    },
    attach(s) {
      sim = s;
    },
  };
}

export function makeWorld(opts: WorldOpts): BuiltWorld {
  const w = buildWorld(opts);
  w.open();
  return w;
}

export function run(w: BuiltWorld, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    w.sim.step();
  }
}
