// Logistics minimap contribution (ADR 0062 step 4a): the road blend
// raster pass. Moved verbatim from compositeMinimapTerrainRgba in
// client/minimap-model.ts.
import { readLayer } from '../../../core/index';
import type { MinimapRasterDef } from '../../../ui/minimap/index';
import { ROAD_LAYER_ID } from '../protocol';

const ROAD_R = 150;
const ROAD_G = 166;
const ROAD_B = 188;

const roadsRaster: MinimapRasterDef = {
  id: 'logistics.roads',
  order: 20,
  keys: (snapshot) => [readLayer(snapshot, ROAD_LAYER_ID)],
  apply(rgba, input) {
    const roadLayer = readLayer(input.snapshot, ROAD_LAYER_ID) ?? undefined;
    if (roadLayer === undefined) {
      return;
    }
    const cellCount = input.map.width * input.map.height;
    for (let i = 0; i < cellCount; i++) {
      if ((roadLayer[i] ?? 0) < 1) {
        continue;
      }
      const o = i * 4;
      rgba[o] = Math.round((rgba[o] ?? 0) * 0.45 + ROAD_R * 0.55);
      rgba[o + 1] = Math.round((rgba[o + 1] ?? 0) * 0.45 + ROAD_G * 0.55);
      rgba[o + 2] = Math.round((rgba[o + 2] ?? 0) * 0.45 + ROAD_B * 0.55);
    }
  },
};

export const logisticsMinimapRasters: readonly MinimapRasterDef[] = [roadsRaster];
