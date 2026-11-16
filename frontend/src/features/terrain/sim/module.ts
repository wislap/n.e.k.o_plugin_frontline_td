// Terrain module: writes the two global grid layers once in onStart (terrain
// is static in M2) and owns nothing else.
import { defineGridLayer } from '../../../kernel/index';
import type { SimModule } from '../../../kernel/index';
import type { ResolvedSurface } from '../../../content/load';
import type { TerrainGrid } from '../content';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';
import { createTerrainApi } from './terrain-api';
import type { TerrainApi } from './terrain-api';

export const HeightLayer = defineGridLayer(TERRAIN_HEIGHT_LAYER_ID, 'u8', {
  perFaction: false,
});
export const SurfaceLayer = defineGridLayer(TERRAIN_SURFACE_LAYER_ID, 'u16', {
  perFaction: false,
});

export function createTerrainModule(
  grid: TerrainGrid,
  surfaces: readonly ResolvedSurface[],
): { module: SimModule; api: TerrainApi } {
  const api = createTerrainApi(grid, surfaces);
  const module: SimModule = {
    id: 'frontline_td:terrain',
    install(builder) {
      const heightWriter = builder.claimLayerWriter(HeightLayer);
      const surfaceWriter = builder.claimLayerWriter(SurfaceLayer);
      builder.onStart((ctx) => {
        ctx.writeLayer(heightWriter).set(grid.heights);
        ctx.writeLayer(surfaceWriter).set(grid.surfaces);
      });
    },
  };
  return { module, api };
}
