// Module and RNG-stream registry assembled by the app (ADR 0019/0023).
// createSimModules wires the M2 feature set; modes will contribute their
// own registries later.
import type { ContentDb } from '../content/index';
import type { ResolvedMap } from '../content/index';
import type { EntityId } from '../core/index';
import {
  createCombatModule,
  healthFraction,
  structureParts as combatStructureParts,
  unitParts as combatUnitParts,
} from '../features/combat/sim/index';
import { createConstructionModule } from '../features/construction/sim/index';
import { createLogisticsModule, structureParts, unitParts } from '../features/logistics/sim/index';
import { createMovementModule } from '../features/movement/sim/index';
import { createPathingModule } from '../features/pathing/sim/index';
import {
  createProductionModule,
  structureParts as productionStructureParts,
} from '../features/production/sim/index';
import { createTerrainModule } from '../features/terrain/sim/index';
import { createUnitsModule } from '../features/units/sim/index';
import type { FactionStart } from '../features/units/sim/index';
import type { SimModule } from '../kernel/index';
import { CONTROLLER_STREAM_ID } from '../kernel/index';

export function createSimModules(
  db: ContentDb,
  map: ResolvedMap,
  starts: readonly FactionStart[],
): SimModule[] {
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
  terrain.api.onBlockedChange(() => {
    logistics.markTopologyDirty();
  });
  // Construction installs before units so start structures block their
  // footprints (setBlocked is immediate) before units' onStart spiral
  // spawns movers around them.
  const construction = createConstructionModule(db, terrain.api, logistics, {
    structureParts: [structureParts, productionStructureParts, combatStructureParts],
    starts,
    healthBp: healthFraction,
  });
  const units = createUnitsModule(db, terrain.api, starts, [unitParts, combatUnitParts], {
    hpBp: healthFraction,
    energyBp: (ctx, id) => logistics.energyBp(ctx, id as EntityId),
  });
  const production = createProductionModule(db);
  // Combat installs last: within the cleanup phase systems run in module
  // registration order, so movement's and construction's combat.died
  // readers (goal release, footprint free) must run before combat's own
  // despawn.
  const combat = createCombatModule();
  return [
    terrain.module,
    pathing.module,
    movement,
    logistics,
    construction,
    units,
    production,
    combat,
  ];
}

export const RNG_STREAMS = [
  { id: CONTROLLER_STREAM_ID, purpose: 'per-faction controller decisions' },
] as const;
