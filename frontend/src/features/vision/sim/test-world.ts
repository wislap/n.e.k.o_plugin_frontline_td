// Shared test world for the vision tests: a small replicate of the
// app's wiring — construction, units and capture take the vision query
// as their `visible` option; the vision module registers last inside
// capture_fog.
import { loadContent } from '../../../content/index';
import type { ContentDb } from '../../../content/index';
import { contentId } from '../../../core/index';
import type { FactionId } from '../../../core/index';
import { toFactionId } from '../../../core/index';
import { createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { Faction, InWorld } from '../../../kernel/index';
import { captureRuinParts } from '../../capture/sim/index';
import { createConstructionModule, Structure } from '../../construction/sim/index';
import { StructuresChannel } from '../../construction/protocol';
import type { ConstructionStructures } from '../../construction/protocol';
import { createLogisticsModule } from '../../logistics/sim/index';
import { createMovementModule, Mover } from '../../movement/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import type { ResolvedSurface } from '../../../content/index';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainModule } from '../../terrain/sim/index';
import { createUnitsModule } from '../../units/sim/index';
import type { FactionStart } from '../../units/sim/index';
import { DenseUnitsChannel, SpawnIntent } from '../../units/protocol';
import type { DenseUnits } from '../../units/protocol';
import type { ReadonlyNumberArray } from '../../../kernel/index';
import { VisionMemoryChannel } from '../protocol';
import type { VisionMemory } from '../protocol';
import { createVisionModule, structureVisionParts, unitVisionParts, VisionLayer } from './index';
import { must } from '../../../testing/index';

const DB: ContentDb = loadContent();
export const F1 = toFactionId(1);
export const F2 = toFactionId(2);
export const W = 40;
const H = 40;

const ROBOT = must(DB.units.byId('frontline_td:robot'), 'robot');
export const DEPOT = must(DB.structures.byId('frontline_td:supply_depot'), 'supply_depot');
export const OUTPOST = must(DB.structures.byId('frontline_td:outpost'), 'outpost');
export const HIVE = must(DB.structures.byId('frontline_td:hive'), 'hive');

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
];

function makeGrid(): TerrainGrid {
  return {
    width: W,
    height: H,
    heights: new Uint8Array(W * H),
    surfaces: new Uint16Array(W * H),
    ramps: new Uint8Array(W * H),
  };
}

export interface WorldOpts {
  starts?: readonly FactionStart[];
  // Extra sim modules (test killers etc.) appended after units.
  extra?: readonly SimModule[];
  omniscient?: ReadonlySet<number>;
}

// Despawns the first mover at `tick`, running in cleanup — before the
// capture_fog recompute of the same tick.
export function despawnFirstMover(tick: number): SimModule {
  return {
    id: `frontline_td:test.despawn_mover_${tick}`,
    install(builder) {
      builder.system({
        id: `frontline_td:test.despawn_mover.hit_${tick}`,
        phase: 'cleanup',
        run(ctx) {
          if (ctx.tick !== tick) {
            return;
          }
          for (const id of ctx.query([Mover, InWorld])) {
            const handle = ctx.handleOf(id as never);
            if (handle !== null) {
              ctx.despawn(handle);
            }
            return;
          }
        },
      });
    },
  };
}

export function makeWorld(opts: WorldOpts = {}) {
  const grid = makeGrid();
  const starts = opts.starts ?? [];
  const terrain = createTerrainModule(grid, SURFACES);
  const pathing = createPathingModule(terrain.api, 1);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  const logistics = createLogisticsModule(DB, terrain.api, { starts });
  terrain.api.onBlockedChange((cells, blocked) => {
    logistics.blockersChanged(cells, blocked);
  });
  const vision = createVisionModule(
    DB,
    grid,
    opts.omniscient !== undefined ? { omniscient: opts.omniscient } : {},
  );
  const construction = createConstructionModule(DB, terrain.api, logistics, {
    structureParts: [structureVisionParts],
    ruinParts: [captureRuinParts],
    starts,
    visible: vision.api.visible,
  });
  const units = createUnitsModule(DB, terrain.api, starts, [unitVisionParts], {
    visible: vision.api.visible,
  });
  const modules: SimModule[] = [
    terrain.module,
    pathing.module,
    movement,
    logistics,
    construction,
    units,
    ...(opts.extra ?? []),
    vision.module,
  ];
  const config: SimConfig = {
    seed: 7,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [{ a: F1, b: F2, relation: 'hostile' }],
    grid: { width: W, height: H },
    rngStreams: [],
    controllers: [],
  };
  const sim = createSimulation(config, modules);
  return {
    config,
    modules,
    sim,
    run(ticks: number) {
      for (let i = 0; i < ticks; i++) {
        sim.step();
      }
    },
    layer(observer: FactionId): ReadonlyNumberArray {
      return sim.snapshot(observer).layers[`${VisionLayer.id}#${Number(observer)}`] ?? [];
    },
    dense(observer: FactionId): DenseUnits {
      return sim.snapshot(observer).channels[DenseUnitsChannel.id] as DenseUnits;
    },
    structures(observer: FactionId): ConstructionStructures {
      return sim.snapshot(observer).channels[StructuresChannel.id] as ConstructionStructures;
    },
    memory(observer: FactionId): VisionMemory {
      return sim.snapshot(observer).channels[VisionMemoryChannel.id] as VisionMemory;
    },
  };
}

export function robotStart(faction: number, x: number, y: number, count = 1): FactionStart {
  return { faction: toFactionId(faction), units: [{ kind: ROBOT.index, x, y, count }] };
}
export function depotStart(faction: number, x: number, y: number): FactionStart {
  return { faction: toFactionId(faction), structures: [{ kind: DEPOT.index, x, y }] };
}

export function structureKinds(
  rows: { handles: { length: number }; kind: Uint16Array },
  kind: number,
): number {
  let n = 0;
  for (let i = 0; i < rows.kind.length; i++) {
    if (rows.kind[i] === kind) {
      n++;
    }
  }
  return n;
}

// Despawn the first structure of `kindIndex` at `tick` (before the
// capture_fog recompute — cleanup runs earlier in the phase order).
export function despawnStructure(kindIndex: number, tick: number): SimModule {
  return {
    id: `frontline_td:test.struct_despawn_${tick}`,
    install(builder) {
      builder.system({
        id: `frontline_td:test.struct_despawn.hit_${tick}`,
        phase: 'cleanup',
        run(ctx) {
          if (ctx.tick !== tick) {
            return;
          }
          const st = ctx.read(Structure);
          for (const id of ctx.query([Structure, InWorld])) {
            if ((st.kind[id] ?? -1) !== kindIndex) {
              continue;
            }
            const handle = ctx.handleOf(id as never);
            if (handle !== null) {
              ctx.despawn(handle);
            }
            return;
          }
        },
      });
    },
  };
}

// Spawns a bare faction-2 structure entity (Structure + InWorld) at
// (x, y) on `tick` — used to exercise entity-id reuse against the
// memory staleness check.
export function spawnBareStructure(
  kindIndex: number,
  x: number,
  y: number,
  tick: number,
): SimModule {
  return {
    id: `frontline_td:test.bare_struct_${tick}`,
    install(builder) {
      builder.system({
        id: `frontline_td:test.bare_struct.go_${tick}`,
        phase: 'cleanup',
        run(ctx) {
          if (ctx.tick === tick) {
            ctx.spawn([[Faction, { id: 2 }], [InWorld], [Structure, { kind: kindIndex, x, y }]]);
          }
        },
      });
    },
  };
}

// Spawns a faction-1 robot at (x+0.5, y+0.5) at `tick` via the units
// SpawnIntent path (the same way production spawns units).
export function spawnRobot(x: number, y: number, tick: number): SimModule {
  return {
    id: `frontline_td:test.spawn_robot_${tick}`,
    install(builder) {
      builder.system({
        id: `frontline_td:test.spawn_robot.go_${tick}`,
        phase: 'cleanup',
        emits: [SpawnIntent],
        run(ctx) {
          if (ctx.tick === tick) {
            ctx.emit(SpawnIntent, {
              faction: 1,
              kind: ROBOT.id,
              x: x + 0.5,
              y: y + 0.5,
              source: 0,
            });
          }
        },
      });
    },
  };
}
