// Terrain minimap contribution (ADR 0062 step 4a): the base raster
// pass — surface colours, elevation brightening and cliff-edge
// darkening. Moved verbatim from client/minimap-model.ts.
import { readLayer } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import type { MinimapRasterDef } from '../../../ui/minimap/index';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';

const DEFAULT_SURFACE_RGB: readonly [number, number, number] = [64, 72, 84];

function parseHexRgb(hex: string | undefined): readonly [number, number, number] {
  if (hex === undefined || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return DEFAULT_SURFACE_RGB;
  }
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

export function buildBaseTerrainRgb(
  db: ContentDb,
  map: ResolvedMap,
  snapshot?: Snapshot | null,
): Uint8Array {
  const { width, height } = map;
  const cellCount = width * height;
  const out = new Uint8Array(cellCount * 3);
  const surfaces = readLayer(snapshot, TERRAIN_SURFACE_LAYER_ID) ?? map.grid.surfaces;
  const heights = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID) ?? map.grid.heights;
  const ramps = map.grid.ramps;

  const palette = new Map<number, readonly [number, number, number]>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sIdx = surfaces[idx] ?? 0;
      let rgb = palette.get(sIdx);
      if (rgb === undefined) {
        rgb = parseHexRgb(db.surfaces.byIndex(sIdx)?.color);
        palette.set(sIdx, rgb);
      }

      const h = heights[idx] ?? 0;
      const boost = h * 14;
      let r = clampByte(rgb[0] + boost);
      let g = clampByte(rgb[1] + boost);
      let b = clampByte(rgb[2] + boost);

      const isRamp = (ramps[idx] ?? 0) !== 0;
      if (!isRamp) {
        const hasCliffEdge =
          (x > 0 && (ramps[idx - 1] ?? 0) === 0 && (heights[idx - 1] ?? 0) !== h) ||
          (x + 1 < width && (ramps[idx + 1] ?? 0) === 0 && (heights[idx + 1] ?? 0) !== h) ||
          (y > 0 && (ramps[idx - width] ?? 0) === 0 && (heights[idx - width] ?? 0) !== h) ||
          (y + 1 < height && (ramps[idx + width] ?? 0) === 0 && (heights[idx + width] ?? 0) !== h);
        if (hasCliffEdge) {
          r = clampByte(r * 0.72);
          g = clampByte(g * 0.72);
          b = clampByte(b * 0.72);
        }
      }

      const o = idx * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }

  return out;
}

const baseRaster: MinimapRasterDef = {
  id: 'terrain.base',
  order: 10,
  // The old cache built the base from map.grid, rebuilt it exactly once
  // when the first snapshot arrived, and never re-read terrain layers
  // afterwards — so the only key is whether a snapshot exists.
  keys: (snapshot) => [snapshot !== null],
  apply(rgba, input) {
    const rgb = buildBaseTerrainRgb(input.db, input.map, input.snapshot);
    const cellCount = input.map.width * input.map.height;
    for (let i = 0; i < cellCount; i++) {
      const o = i * 4;
      const bi = i * 3;
      rgba[o] = rgb[bi] ?? 0;
      rgba[o + 1] = rgb[bi + 1] ?? 0;
      rgba[o + 2] = rgb[bi + 2] ?? 0;
      rgba[o + 3] = 255;
    }
  },
};

export const terrainMinimapRasters: readonly MinimapRasterDef[] = [baseRaster];
