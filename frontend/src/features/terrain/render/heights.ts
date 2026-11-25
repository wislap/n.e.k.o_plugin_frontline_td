// Terrain height layer access for the client shell (ADR 0062 step 4b):
// the canvas needs the live height grid for rays and ground projection
// without knowing the terrain layer id.
import { readLayer, type Snapshot } from '../../../core/index';
import { TERRAIN_HEIGHT_LAYER_ID } from '../protocol';

export function readTerrainHeights(snapshot: Snapshot | null): ArrayLike<number> | null {
  return readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID);
}
