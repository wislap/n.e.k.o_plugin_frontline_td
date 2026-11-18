// Terrain module: writes the height/surface layers once in onStart, owns the
// dynamic blocker overlay (M3), serializes it via builder.state, and mirrors
// it into the blocked layer whenever it changes.
import type { Serializable } from '../../../core/index';
import { defineGridLayer } from '../../../kernel/index';
import type { SimModule } from '../../../kernel/index';
import type { ResolvedSurface } from '../../../content/load';
import type { TerrainGrid } from '../content';
import {
  TERRAIN_BLOCKED_LAYER_ID,
  TERRAIN_HEIGHT_LAYER_ID,
  TERRAIN_SURFACE_LAYER_ID,
} from '../protocol';
import { createTerrainApiWithStore } from './terrain-api';
import type { TerrainApi } from './terrain-api';

const HeightLayer = defineGridLayer(TERRAIN_HEIGHT_LAYER_ID, 'u8', {
  perFaction: false,
});
const SurfaceLayer = defineGridLayer(TERRAIN_SURFACE_LAYER_ID, 'u16', {
  perFaction: false,
});
const BlockedLayer = defineGridLayer(TERRAIN_BLOCKED_LAYER_ID, 'u8', {
  perFaction: false,
});

export function createTerrainModule(
  grid: TerrainGrid,
  surfaces: readonly ResolvedSurface[],
): { module: SimModule; api: TerrainApi } {
  const { api, blocked } = createTerrainApiWithStore(grid, surfaces);
  const module: SimModule = {
    id: 'frontline_td:terrain',
    install(builder) {
      const heightWriter = builder.claimLayerWriter(HeightLayer);
      const surfaceWriter = builder.claimLayerWriter(SurfaceLayer);
      const blockedWriter = builder.claimLayerWriter(BlockedLayer);
      builder.state('frontline_td:terrain.blocked_overlay', {
        save(): Serializable {
          return blocked.save();
        },
        load(data: Serializable): void {
          blocked.load(data);
        },
      });
      builder.onStart((ctx) => {
        ctx.writeLayer(heightWriter).set(grid.heights);
        ctx.writeLayer(surfaceWriter).set(grid.surfaces);
      });
      // Must run in the LAST phase: setBlocked may be called from any
      // earlier phase (including construction, which runs after cleanup),
      // and an unmirrored dirty flag is not serialized — letting it survive
      // a tick boundary would make a restored sim diverge.
      builder.system({
        id: 'frontline_td:terrain.mirror_blocked',
        phase: 'capture_fog',
        run(ctx) {
          if (blocked.takeDirty()) {
            ctx.writeLayer(blockedWriter).set(blocked.save());
          }
        },
      });
    },
  };
  return { module, api };
}
