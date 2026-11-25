// Terrain minimap raster test (ADR 0062 step 4a): re-homed from
// client/minimap-model.test.ts — elevation brightening and
// cliff-edge darkening unless cells are ramps.
import { describe, expect, it } from 'vitest';
import { loadContent, type ResolvedMap } from '../../../content/index';
import { buildBaseTerrainRgb, terrainMinimapRasters } from './minimap';

const db = loadContent();
const GROUND = db.surfaces.byId('frontline_td:ground');
if (GROUND === undefined) {
  throw new Error('required content missing');
}
const groundSurfaceIndex = GROUND.index;

function makeTestMap(width: number, height: number): ResolvedMap {
  const size = width * height;
  return {
    id: 'frontline_td:test_map' as ResolvedMap['id'],
    index: 0,
    width,
    height,
    points: {},
    grid: {
      width,
      height,
      heights: new Uint8Array(size),
      surfaces: new Uint16Array(size).fill(groundSurfaceIndex),
      ramps: new Uint8Array(size),
    },
  };
}

describe('terrain minimap base raster', () => {
  it('applies elevation brightening and cliff darkening unless cells are ramps', () => {
    const map = makeTestMap(3, 1);
    map.grid.heights[0] = 0;
    map.grid.heights[1] = 2;
    map.grid.heights[2] = 2;

    const rgb = buildBaseTerrainRgb(db, map);
    // Ground is #5a8f3c -> (90, 143, 60)
    // Cell 0: h=0, adjacent to h=2 non-ramp -> cliff darkened (* 0.72)
    expect(Array.from(rgb.slice(0, 3))).toEqual([
      Math.round(90 * 0.72),
      Math.round(143 * 0.72),
      Math.round(60 * 0.72),
    ]);
    // Cell 1: h=2 (+28), adjacent to h=0 non-ramp -> cliff darkened (* 0.72)
    expect(Array.from(rgb.slice(3, 6))).toEqual([
      Math.round((90 + 28) * 0.72),
      Math.round((143 + 28) * 0.72),
      Math.round((60 + 28) * 0.72),
    ]);
    // Cell 2: h=2 (+28), neighbor cell 1 also h=2 -> no cliff darkening
    expect(Array.from(rgb.slice(6, 9))).toEqual([90 + 28, 143 + 28, 60 + 28]);

    // Marking cell 0 as a ramp removes cliff darkening on both cell 0 and cell 1
    map.grid.ramps[0] = 1;
    const rampRgb = buildBaseTerrainRgb(db, map);
    expect(Array.from(rampRgb.slice(0, 3))).toEqual([90, 143, 60]);
    expect(Array.from(rampRgb.slice(3, 6))).toEqual([90 + 28, 143 + 28, 60 + 28]);
  });

  it('writes base rgb with opaque alpha into the raster buffer', () => {
    const map = makeTestMap(1, 1);
    const rgba = new Uint8ClampedArray(4);
    terrainMinimapRasters[0]?.apply(rgba, { db, map, snapshot: null });
    expect(Array.from(rgba)).toEqual([90, 143, 60, 255]);
  });
});
