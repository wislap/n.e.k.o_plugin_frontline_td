// Module and RNG-stream registry assembled by the app (ADR 0019/0023).
// createSimModules wires the M2 feature set; modes will contribute their
// own registries later.
import type { ContentDb } from '../content/index';
import type { ResolvedMap } from '../content/index';
import { createMovementModule } from '../features/movement/sim/index';
import { createPathingModule } from '../features/pathing/sim/index';
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
  const terrain = createTerrainModule(map.grid, db.surfaces.list);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  const movement = createMovementModule(terrain.api, pathing.api);
  const units = createUnitsModule(db, terrain.api, starts);
  return [terrain.module, pathing.module, movement, units];
}

export const RNG_STREAMS = [
  { id: CONTROLLER_STREAM_ID, purpose: 'per-faction controller decisions' },
] as const;
