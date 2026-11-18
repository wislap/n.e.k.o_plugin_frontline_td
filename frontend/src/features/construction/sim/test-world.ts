// Shared construction test harness: flat ASCII grid, a fully wired world
// (terrain + pathing + movement + logistics + construction) with the real
// structureParts injection, plus command/snapshot/inspection helpers.
import type { ContentDb, ResolvedStructure } from '../../../content/index';
import { loadContent } from '../../../content/index';
import type { EntityHandle, Serializable } from '../../../core/index';
import { contentId, toFactionId, toTick } from '../../../core/index';
import type { FactionId } from '../../../core/index';
import { Faction, InWorld, createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule, SpawnInit } from '../../../kernel/index';
import { COMMAND_REJECTED } from '../../../core/index';
import type { CommandEnvelope, CommandRejectedPayload } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/index';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainModule } from '../../terrain/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import { Position, createMovementModule, moverComponents } from '../../movement/sim/index';
import { createLogisticsModule, structureParts } from '../../logistics/sim/index';
import type { LogisticsModule } from '../../logistics/sim/index';
import type { FactionStart } from '../../units/sim/index';
import { RoadWorksChannel, SalvageChannel, StructuresChannel } from '../protocol';
import type { ConstructionSalvage, ConstructionStructures, RoadWorks } from '../protocol';
import { createConstructionModule } from './module';
import type { RoadSegmentPartsFn, RuinPartsFn, StructurePartsFn } from './env';
import { Structure } from './components';

const DB: ContentDb = loadContent();
export const F1 = toFactionId(1);
export const F2 = toFactionId(2);
export const CYCLE = DB.logistics.cycleTicks;
export const MATERIAL = DB.cargos.byId('frontline_td:material')?.index ?? -1;
const CLS_GROUND = DB.movementClasses.byId('frontline_td:ground')?.index ?? 0;

function must<T>(v: T | undefined, name: string): T {
  if (v === undefined) {
    throw new Error(`base pack entry '${name}' missing`);
  }
  return v;
}
export const STATION = must(DB.structures.byId('frontline_td:station'), 'station');
export const DEPOT = must(DB.structures.byId('frontline_td:supply_depot'), 'supply_depot');
export const BASE = must(DB.structures.byId('frontline_td:main_base'), 'main_base');

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

// '.': flat ground, '#': impassable rock, '^': ramp cell (flat height).
function makeGrid(rows: string[]): TerrainGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const heights = new Uint8Array(width * height);
  const surfaces = new Uint16Array(width * height);
  const ramps = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const c = row[x];
      if (c === '#') {
        surfaces[y * width + x] = 1;
      } else if (c === '^') {
        ramps[y * width + x] = 1;
      } else if (c === 'p') {
        heights[y * width + x] = 1;
      }
    }
  });
  return { width, height, heights, surfaces, ramps };
}

// Spawn a completed structure entity raw (as the app would get from
// start.structures after onStart): parts + the Structure marker.
export function structureInit(kind: ResolvedStructure, x: number, y: number): SpawnInit {
  return [[Structure, { kind: kind.index, x, y }], ...structureParts(kind, x, y, 'complete', 0)];
}

// A mover entity for units_in_way tests.
export function moverInit(x: number, y: number): SpawnInit {
  return [...moverComponents(x + 0.5, y + 0.5, 0.125, 0.35, CLS_GROUND)];
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
  // Road-segment parts injected like the app does (logistics + combat).
  segmentParts?: readonly RoadSegmentPartsFn[];
  // Extra structure parts appended after the logistics default.
  structureParts?: readonly StructurePartsFn[];
  // Ruin parts injected like the app does (capture progress).
  ruinParts?: readonly RuinPartsFn[];
  // Faction relations for exclusion/hostility tests.
  relations?: readonly { a: number; b: number; relation: 'hostile' | 'allied' | 'neutral' }[];
  // Extra sim modules appended after construction (e.g. combat).
  extraModules?: readonly SimModule[];
}

interface InspectConstruction {
  state: string;
  kind: string;
  progress: number;
  total: number;
  progressBp: number;
  waiting: string | null;
  slots?: { cargo: number; required: number; delivered: number }[];
}

export interface BuiltWorld {
  config: SimConfig;
  modules: SimModule[];
  sim: ReturnType<typeof createSimulation>;
  handles: EntityHandle[];
  terrain: TerrainApi;
  // Submit a command for the next tick.
  issue(type: string, payload: Serializable, issuer?: FactionId): void;
  // Step once and collect this tick's reject reasons for the issuer.
  rejections(issuer?: FactionId): string[];
  structures(observer?: FactionId): ConstructionStructures;
  salvage(observer?: FactionId): ConstructionSalvage;
  roadworks(observer?: FactionId): RoadWorks;
  logistics: LogisticsModule;
  inspect(handle: EntityHandle | number, observer?: FactionId): InspectConstruction | null;
  // Live position of entity index i (probe-backed).
  pos(i: number): { x: number; y: number };
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
    structureParts: [structureParts, ...(opts.structureParts ?? [])],
    ...(opts.segmentParts !== undefined ? { segmentParts: opts.segmentParts } : {}),
    ruinParts: opts.ruinParts ?? [],
    starts: opts.starts ?? [],
  });

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
        builder.probe(`frontline_td:test.u${i}x`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(Position).x[id] ?? -1);
        });
        builder.probe(`frontline_td:test.u${i}y`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(Position).y[id] ?? -1);
        });
      });
    },
  };

  const factions = (opts.factions ?? [1]).map((f) => ({ id: toFactionId(f) }));
  const config: SimConfig = {
    seed: 7,
    factions,
    relations: (opts.relations ?? []).map((r) => ({
      a: toFactionId(r.a),
      b: toFactionId(r.b),
      relation: r.relation,
    })),
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
    ...(opts.extraModules ?? []),
    spawner,
  ];
  let sim: ReturnType<typeof createSimulation> | null = null;
  return {
    config,
    modules,
    handles,
    logistics,
    terrain: terrain.api,
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
    structures(observer = F1) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s.snapshot(observer).channels[StructuresChannel.id] as ConstructionStructures;
    },
    salvage(observer = F1) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s.snapshot(observer).channels[SalvageChannel.id] as ConstructionSalvage;
    },
    roadworks(observer = F1) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s.snapshot(observer).channels[RoadWorksChannel.id] as RoadWorks;
    },
    inspect(handle, observer = F1) {
      const s = sim as ReturnType<typeof createSimulation>;
      const h = (typeof handle === 'number' ? handle : Number(handle)) as EntityHandle;
      const out = s.inspect(observer, h);
      return (out?.sections['frontline_td:construction'] ?? null) as InspectConstruction | null;
    },
    pos(i) {
      const s = sim as ReturnType<typeof createSimulation>;
      const probes = s.probes();
      return {
        x: probes[`frontline_td:test.u${i}x`] ?? -1,
        y: probes[`frontline_td:test.u${i}y`] ?? -1,
      };
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
