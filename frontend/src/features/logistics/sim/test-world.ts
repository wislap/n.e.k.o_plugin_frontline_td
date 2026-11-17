// Shared logistics test harness: flat ASCII grid, a fully wired world
// (terrain + pathing + movement + logistics) and spawn/inspection helpers.
// Entities are spawned through the same parts factories the app injects.
import type { ContentDb } from '../../../content/index';
import { loadContent } from '../../../content/index';
import type { EntityHandle } from '../../../core/index';
import { contentId, toFactionId } from '../../../core/index';
import { Faction, InWorld, createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule, SpawnInit, SystemContext } from '../../../kernel/index';
import { Position, createMovementModule, moverComponents } from '../../movement/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import type { ResolvedSurface } from '../../../content/index';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainModule } from '../../terrain/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { LogisticsNetworkChannel } from '../protocol';
import type { LogisticsNetwork } from '../protocol';
import { CARGO_SLOTS, CargoStore, EMPTY_CARGO, LogisticsNode } from './components';
import type { LogisticsModule, LogisticsStart } from './module';
import { createLogisticsModule } from './module';

export const DB: ContentDb = loadContent();
export const ENERGY = DB.cargos.byId('frontline_td:energy')?.index ?? -1;
const CLS_GROUND = DB.movementClasses.byId('frontline_td:ground')?.index ?? 0;
export const CYCLE = DB.logistics.cycleTicks;
export const F1 = toFactionId(1);

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

// '.': ground, '#': impassable.
function makeGrid(rows: string[]): TerrainGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const heights = new Uint8Array(width * height);
  const surfaces = new Uint16Array(width * height);
  const ramps = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      if (row[x] === '#') {
        surfaces[y * width + x] = 1;
      }
    }
  });
  return { width, height, heights, surfaces, ramps };
}

export interface SlotSpec {
  cargo: number;
  cap: number;
  amt?: number;
  cls: number;
  flags?: number;
  rate?: number;
  since?: number;
}

// A CargoStore spawn record from simple slot specs (milli amounts).
export function storeInit(slots: readonly SlotSpec[]): Record<string, number> {
  const v: Record<string, number> = { bottleneck: 0 };
  for (let i = 0; i < CARGO_SLOTS; i++) {
    const s = slots[i];
    v[`cargo${i}`] = s === undefined ? EMPTY_CARGO : s.cargo;
    v[`cap${i}`] = s?.cap ?? 0;
    v[`amt${i}`] = s?.amt ?? 0;
    v[`cls${i}`] = s?.cls ?? 0;
    v[`flags${i}`] = s?.flags ?? 0;
    v[`since${i}`] = s?.since ?? 0;
    v[`rate${i}`] = s?.rate ?? 0;
    v[`unmet${i}`] = 0;
  }
  return v;
}

export interface NodeSpec {
  connect: number;
  service: number;
  vehicles: number;
  warehouse?: boolean;
  w?: number;
  h?: number;
}

// A completed logistics node entity (x, y is the footprint top-left).
export function nodeParts(
  x: number,
  y: number,
  node: NodeSpec,
  stores: ReturnType<typeof storeInit> = storeInit([]),
): SpawnInit {
  const w = node.w ?? 1;
  const h = node.h ?? 1;
  return [
    [Position, { x: x + w / 2, y: y + h / 2 }],
    [
      LogisticsNode,
      {
        connect: node.connect,
        service: node.service,
        vehicles: node.vehicles,
        warehouse: node.warehouse === true ? 1 : 0,
        w,
        h,
      },
    ],
    [CargoStore, stores],
  ];
}

// A covered consumer entity with a demand store.
export function consumerParts(
  x: number,
  y: number,
  stores: ReturnType<typeof storeInit>,
): SpawnInit {
  return [
    [Position, { x: x + 0.5, y: y + 0.5 }],
    [CargoStore, stores],
  ];
}

// A mover entity with a store (for energy-modifier tests).
export function moverParts(x: number, y: number, stores: ReturnType<typeof storeInit>): SpawnInit {
  return [...moverComponents(x + 0.5, y + 0.5, 0.125, 0.35, CLS_GROUND), [CargoStore, stores]];
}

interface TestEnt {
  parts: SpawnInit;
  faction?: number;
}

interface WorldOpts {
  rows: string[];
  entities?: readonly TestEnt[];
  starts?: readonly LogisticsStart[];
  factions?: readonly number[];
  healthBp?: number;
  onTick?: (ctx: SystemContext, handles: readonly EntityHandle[]) => void;
}

interface InspectSection {
  slots: {
    cargo: string;
    capacity: number;
    amount: number;
    class: string;
    unmet: string;
    export: boolean;
  }[];
  bottleneck: number;
  attachedNode: number | null;
}

interface World {
  sim: ReturnType<typeof createSimulation>;
  handles: EntityHandle[];
  terrain: TerrainApi;
  inspect(i: number, observer?: number): InspectSection | null;
  network(faction?: number): LogisticsNetwork;
}

export interface BuiltWorld extends World {
  config: SimConfig;
  modules: SimModule[];
  logistics: LogisticsModule;
  // Attach a sim instance (create or restore).
  open(): ReturnType<typeof createSimulation>;
  attach(s: ReturnType<typeof createSimulation>): void;
}

// Build config + modules without starting the sim; restoreSimulation
// needs fresh module instances (they hold derived topology state).
export function buildWorld(opts: WorldOpts): BuiltWorld {
  const grid = makeGrid(opts.rows);
  const terrain = createTerrainModule(grid, SURFACES);
  const pathing = createPathingModule(terrain.api, 1);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  const logistics = createLogisticsModule(DB, terrain.api, {
    starts: opts.starts ?? [],
    ...(opts.healthBp !== undefined ? { healthBp: () => opts.healthBp as number } : {}),
  });
  terrain.api.onBlockedChange(() => {
    logistics.markTopologyDirty();
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
      if (opts.onTick !== undefined) {
        const onTick = opts.onTick;
        builder.system({
          id: 'frontline_td:test.tick',
          phase: 'construction',
          run(ctx) {
            onTick(ctx, handles);
          },
        });
      }
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
  const modules: SimModule[] = [terrain.module, pathing.module, movement, logistics, spawner];
  let sim: ReturnType<typeof createSimulation> | null = null;
  const world: BuiltWorld = {
    config,
    modules,
    logistics,
    get sim() {
      return sim as ReturnType<typeof createSimulation>;
    },
    handles,
    terrain: terrain.api,
    inspect(i, observer = 1) {
      const s = sim as ReturnType<typeof createSimulation>;
      const out = s.inspect(toFactionId(observer), handles[i] ?? (0 as EntityHandle));
      return (out?.sections['frontline_td:logistics'] ?? null) as InspectSection | null;
    },
    network(faction = 1) {
      const s = sim as ReturnType<typeof createSimulation>;
      return s.snapshot(toFactionId(faction)).channels[
        LogisticsNetworkChannel.id
      ] as LogisticsNetwork;
    },
    open() {
      sim = createSimulation(config, modules);
      return sim;
    },
    attach(s) {
      sim = s;
    },
  };
  return world;
}

export function makeWorld(opts: WorldOpts): BuiltWorld {
  const world = buildWorld(opts);
  world.open();
  return world;
}

export function run(sim: ReturnType<typeof createSimulation>, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
  }
}

// Build a ResolvedStoreProfile-free slot spec from unit capacities for
// readability in tests.
export function demandSlot(cargo: number, cap: number, cls: number, amt = 0): SlotSpec {
  return { cargo, cap, cls, amt };
}
