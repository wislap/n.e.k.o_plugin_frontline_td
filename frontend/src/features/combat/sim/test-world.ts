// Shared combat test harness: flat ASCII grid, a fully wired world
// (terrain + pathing + movement + logistics + construction + production +
// combat) with the real structureParts/unitParts injection, plus helpers
// for commands, events, slot amounts and health probes.
import type { ContentDb, ResolvedStructure, ResolvedUnit } from '../../../content/index';
import { loadContent } from '../../../content/index';
import { contentId, toFactionId, toTick } from '../../../core/index';
import type { CommandEnvelope, EntityHandle, FactionId, Serializable } from '../../../core/index';
import { Faction, InWorld, createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule, SpawnInit } from '../../../kernel/index';
import type { ResolvedSurface } from '../../../content/index';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainModule } from '../../terrain/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import type { PathingApi } from '../../pathing/sim/index';
import { createMovementModule, moverComponents } from '../../movement/sim/index';
import {
  createLogisticsModule,
  structureParts as logisticsStructureParts,
  unitParts as logisticsUnitParts,
} from '../../logistics/sim/index';
import { createConstructionModule, Structure } from '../../construction/sim/index';
import {
  createProductionModule,
  structureParts as productionStructureParts,
} from '../../production/sim/index';
import type { FactionStart } from '../../units/sim/index';
import { structureParts as combatStructureParts, unitParts as combatUnitParts } from './parts';
import { createCombatModule } from './module';
import { Health } from './components';

const DB: ContentDb = loadContent();
export const F1 = toFactionId(1);
export const CYCLE = DB.logistics.cycleTicks;
export const ENERGY = DB.cargos.byId('frontline_td:energy')?.index ?? -1;
export const AMMO = DB.cargos.byId('frontline_td:ammo')?.index ?? -1;
const CLS_GROUND = DB.movementClasses.byId('frontline_td:ground')?.index ?? 0;

function must<T>(v: T | undefined, name: string): T {
  if (v === undefined) {
    throw new Error(`base pack entry '${name}' missing`);
  }
  return v;
}
export const ROBOT = must(DB.units.byId('frontline_td:robot'), 'robot');
export const TURRET = must(DB.structures.byId('frontline_td:turret'), 'turret');
export const BASE = must(DB.structures.byId('frontline_td:main_base'), 'main_base');

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
];

function makeGrid(rows: string[]): TerrainGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const surfaces = new Uint16Array(width * height);
  const heights = new Uint8Array(width * height);
  const ramps = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      if (row[x] === 'p') {
        heights[y * width + x] = 1;
      }
    }
  });
  return { width, height, heights, surfaces, ramps };
}

type PartPatch = (comp: unknown, init: Record<string, number>) => Record<string, number>;

function applyPatch(parts: SpawnInit, patch?: PartPatch): SpawnInit {
  if (patch === undefined) {
    return parts;
  }
  return parts.map(([comp, init]) => [
    comp,
    patch(comp, { ...(init ?? {}) } as Record<string, number>),
  ]);
}

// A completed structure entity (as a start.structures spawn would get):
// marker + all contributed parts. `patch` can override CargoStore slot
// fields (e.g. preload ammo).
export function structureInit(
  kind: ResolvedStructure,
  x: number,
  y: number,
  patch?: PartPatch,
): SpawnInit {
  return applyPatch(
    [
      [Structure, { kind: kind.index, x, y }],
      ...logisticsStructureParts(kind, x, y, 'complete', 0),
      ...productionStructureParts(kind),
      ...combatStructureParts(kind),
    ],
    patch,
  );
}

// A combat-ready mover: mover components + logistics battery + combat
// parts (health, targetable, weapon).
export function robotInit(unit: ResolvedUnit, x: number, y: number, patch?: PartPatch): SpawnInit {
  return applyPatch(
    [
      ...moverComponents(x + 0.5, y + 0.5, unit.cellsPerTick, unit.radius, CLS_GROUND),
      ...logisticsUnitParts(unit),
      ...combatUnitParts(unit),
    ],
    patch,
  );
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
  // Extra modules appended after the spawner (e.g. test damage emitters).
  extraModules?: readonly SimModule[];
}

export interface BuiltWorld {
  config: SimConfig;
  modules: SimModule[];
  sim: ReturnType<typeof createSimulation>;
  handles: EntityHandle[];
  terrain: TerrainApi;
  pathing: PathingApi;
  issue(type: string, payload: Serializable, issuer?: FactionId): void;
  // Event payloads of `type` accumulated across every stepped tick
  // (snapshot events are per-tick; run() records them).
  events(type: string): readonly Serializable[];
  // Per-tick event accumulation filled by run().
  eventLog: Map<string, Serializable[]>;
  // Resolved entity id of spawned entity i, -1 once despawned.
  alive(i: number): number;
  // Health.hp of spawned entity i (-1 when gone).
  hp(i: number): number;
  // Total amount of `cargo` (registry index) in entity i's store (F1-owned).
  storeAmount(i: number, cargo: number): number;
  inspect(i: number, section: string): Record<string, unknown> | null;
  open(): ReturnType<typeof createSimulation>;
  attach(s: ReturnType<typeof createSimulation>): void;
}

export function buildWorld(opts: WorldOpts): BuiltWorld {
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
    structureParts: [logisticsStructureParts, productionStructureParts, combatStructureParts],
    starts: opts.starts ?? [],
  });
  const production = createProductionModule(DB);
  const combat = createCombatModule();

  const handles: EntityHandle[] = [];
  const spawner: SimModule = {
    id: 'frontline_td:test.spawn',
    install(builder) {
      builder.onStart((ctx) => {
        for (const ent of opts.entities ?? []) {
          handles.push(ctx.spawn([[Faction, { id: ent.faction ?? 1 }], [InWorld], ...ent.parts]));
        }
      });
      (opts.entities ?? []).forEach((_, i) => {
        builder.probe(
          `frontline_td:test.a${i}`,
          (ctx) => ctx.resolve(handles[i] ?? (0 as EntityHandle)) ?? -1,
        );
        builder.probe(`frontline_td:test.hp${i}`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null || !ctx.has(Health, id) ? -1 : (ctx.read(Health).hp[id] ?? -1);
        });
      });
    },
  };

  const factions = (opts.factions ?? [1]).map((f) => ({ id: toFactionId(f) }));
  const relations =
    factions.length >= 2
      ? [
          {
            a: factions[0]?.id ?? F1,
            b: factions[1]?.id ?? toFactionId(2),
            relation: 'hostile' as const,
          },
        ]
      : [];
  const config: SimConfig = {
    seed: 7,
    factions,
    relations,
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
    combat,
    spawner,
    ...(opts.extraModules ?? []),
  ];
  let sim: ReturnType<typeof createSimulation> | null = null;
  const eventLog = new Map<string, Serializable[]>();
  return {
    eventLog,
    config,
    modules,
    handles,
    terrain: terrain.api,
    pathing: pathing.api,
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
    events(type) {
      return eventLog.get(type) ?? [];
    },
    alive(i) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s.probes()[`frontline_td:test.a${i}`] ?? -1;
    },
    hp(i) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s.probes()[`frontline_td:test.hp${i}`] ?? -1;
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
    // Snapshot events are per-tick; accumulate them so tests can assert
    // on the whole run. 'all'-visibility events are identical for every
    // observer, so faction 1's snapshot is representative.
    for (const e of w.sim.snapshot(F1).events) {
      const list = w.eventLog.get(e.type);
      if (list === undefined) {
        w.eventLog.set(e.type, [e.payload]);
      } else {
        list.push(e.payload);
      }
    }
  }
}
