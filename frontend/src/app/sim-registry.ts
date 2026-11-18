// Module and RNG-stream registry assembled by the app (ADR 0019/0023).
// createSimModules wires the full feature set; modes add their own
// modules (victory, probes) on top via their registry entries.
import type { ContentDb } from '../content/index';
import type { ResolvedMap } from '../content/index';
import type { EntityId } from '../core/index';
import {
  createCombatModule,
  healthFraction,
  roadSegmentParts as combatRoadParts,
  structureParts as combatStructureParts,
  unitParts as combatUnitParts,
} from '../features/combat/sim/index';
import { captureRuinParts, createCaptureModule } from '../features/capture/sim/index';
import { createConstructionModule } from '../features/construction/sim/index';
import {
  createLogisticsModule,
  roadSegmentParts as logisticsRoadParts,
  structureParts,
  unitParts,
} from '../features/logistics/sim/index';
import { createMovementModule } from '../features/movement/sim/index';
import { createPathingModule } from '../features/pathing/sim/index';
import {
  createProductionModule,
  structureParts as productionStructureParts,
} from '../features/production/sim/index';
import { createSquadsModule } from '../features/squads/sim/index';
import { createTerrainModule } from '../features/terrain/sim/index';
import { createUnitsModule } from '../features/units/sim/index';
import {
  createVisionModule,
  structureVisionParts,
  unitVisionParts,
} from '../features/vision/sim/index';
import type { FactionStart } from '../features/units/sim/index';
import type { SimModule } from '../kernel/index';
import { CONTROLLER_STREAM_ID } from '../kernel/index';

// Content integrity: a missing cargo id is a pack bug, not a value to
// default — squads' resupply reads would silently degrade on -1.
function requireCargoIndex(db: ContentDb, id: string): number {
  const cargo = db.cargos.byId(id);
  if (cargo === undefined) {
    throw new Error(`content db is missing required cargo '${id}'`);
  }
  return cargo.index;
}

export interface SimModulesResult {
  modules: SimModule[];
  // Exposed so mode modules (assault probes) can use its public queries.
  logistics: ReturnType<typeof createLogisticsModule>;
}

export interface SimModulesOptions {
  // Per-faction fog mode from the match setup (M5); absent = all fog.
  vision?: ReadonlyMap<number, 'fog' | 'omniscient'>;
}

export function createSimModules(
  db: ContentDb,
  map: ResolvedMap,
  starts: readonly FactionStart[],
  options: SimModulesOptions = {},
): SimModulesResult {
  // Module order matters: terrain must install before pathing so that on
  // restore terrain's blocked overlay loads first — pathing's load rebuilds
  // all class graphs against it. Pathing invalidates on runtime changes.
  const terrain = createTerrainModule(map.grid, db.surfaces.list);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  // Logistics installs before construction: construction only needs its
  // public queries and structureParts at install time. healthBp comes
  // from combat's healthFraction (logistics must not import combat).
  const logistics = createLogisticsModule(db, terrain.api, {
    starts,
    healthBp: healthFraction,
  });
  terrain.api.onBlockedChange((cells, blocked) => {
    logistics.blockersChanged(cells, blocked);
  });
  // Construction installs before units so start structures block their
  // footprints (setBlocked is immediate) before units' onStart spiral
  // spawns movers around them.
  // Vision is created before the modules it filters (they take its
  // query as an injected option at install time); its module registers
  // last so the recompute runs after capture inside capture_fog.
  const omniscient = new Set<number>();
  for (const [f, mode] of options.vision ?? []) {
    if (mode === 'omniscient') {
      omniscient.add(f);
    }
  }
  const vision = createVisionModule(db, map.grid, { omniscient });
  const construction = createConstructionModule(db, terrain.api, logistics, {
    structureParts: [
      structureParts,
      productionStructureParts,
      combatStructureParts,
      structureVisionParts,
    ],
    // Road segments: logistics site slots + FixedAttach, combat hp/hitbox.
    segmentParts: [logisticsRoadParts, combatRoadParts],
    ruinParts: [captureRuinParts],
    starts,
    healthBp: healthFraction,
    visible: vision.api.visible,
  });
  const units = createUnitsModule(
    db,
    terrain.api,
    starts,
    [unitParts, combatUnitParts, unitVisionParts],
    {
      hpBp: healthFraction,
      energyBp: (ctx, id) => logistics.energyBp(ctx, id as EntityId),
      visible: vision.api.visible,
    },
  );
  const production = createProductionModule(db);
  // Combat installs last: within a phase systems run in module
  // registration order, and the order is load-bearing — moving combat
  // earlier changes the match hash because the cleanup systems that read
  // combat.died (movement's goal release, construction's footprint free,
  // which itself despawns emptied structures) enqueue their structural
  // ops before combat's mass despawn. Despawn order sets the entity
  // free-list, which sets which ids later spawns reuse.
  const combat = createCombatModule();
  const capture = createCaptureModule(db, { visible: vision.api.visible });
  // Squads read combat's public queries, logistics coverage and pathing;
  // they order units through movement intents only.
  const squads = createSquadsModule({
    db,
    terrain: terrain.api,
    pathing: pathing.api,
    logistics,
    combat,
    energyCargo: requireCargoIndex(db, 'frontline_td:energy'),
    visible: vision.api.visible,
  });
  return {
    logistics,
    modules: [
      terrain.module,
      pathing.module,
      movement,
      logistics,
      construction,
      units,
      production,
      combat,
      squads,
      capture,
      vision.module,
    ],
  };
}

export const RNG_STREAMS = [
  { id: CONTROLLER_STREAM_ID, purpose: 'per-faction controller decisions' },
] as const;
