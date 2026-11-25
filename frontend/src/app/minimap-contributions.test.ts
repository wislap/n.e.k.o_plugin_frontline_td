// Minimap contribution assembly tests (ADR 0062 step 4a): re-homed
// composite cases from client/minimap-model.test.ts — the sorted
// raster stack (terrain → roads → fog) must be bit-identical to the
// old compositeMinimapTerrainRgba, including unexplored cells
// overwriting road colour. Also covers the null-snapshot collect case.
import { describe, expect, it } from 'vitest';
import { loadContent, type ResolvedMap } from '../content/index';
import { toFactionId, toTick, type Snapshot } from '../core/index';
import { ROAD_LAYER_ID } from '../features/logistics/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../features/terrain/protocol';
import { VISION_STATE_LAYER_ID } from '../features/vision/protocol';
import { MINIMAP_MARKS, MINIMAP_RASTERS } from './minimap-contributions';

const db = loadContent();
const GROUND = db.surfaces.byId('frontline_td:ground');
const DEEP_WATER = db.surfaces.byId('frontline_td:deep_water');
const ORE_FIELD = db.surfaces.byId('frontline_td:ore_field');
if (GROUND === undefined || DEEP_WATER === undefined || ORE_FIELD === undefined) {
  throw new Error('required content missing');
}
const groundSurfaceIndex = GROUND.index;

const OBSERVER = 1;
const isHostile = (observer: number, faction: number): boolean =>
  faction !== 0 && faction !== observer;

function makeSnapshot(
  channels: Snapshot['channels'] = {},
  layers: Snapshot['layers'] = {},
): Snapshot {
  return {
    tick: toTick(10),
    observer: toFactionId(OBSERVER),
    channels,
    events: [],
    layers,
    changedLayers: [],
  };
}

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

function composite(map: ResolvedMap, snapshot: Snapshot | null): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(map.width * map.height * 4);
  const input = { db, map, snapshot };
  for (const raster of MINIMAP_RASTERS) {
    raster.apply(rgba, input);
  }
  return rgba;
}

describe('minimap raster stack (terrain → roads → fog)', () => {
  it('enforces strict fog non-leakage on unexplored cells and missing vision layer', () => {
    const map = makeTestMap(3, 1);
    const surfaces = new Uint16Array([ORE_FIELD.index, GROUND.index, DEEP_WATER.index]);
    const heights = new Uint8Array([0, 2, 1]);
    const roads = new Uint8Array([1, 1, 1]);
    const snap = makeSnapshot(
      {},
      {
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
        [ROAD_LAYER_ID]: roads,
        [`${VISION_STATE_LAYER_ID}#${OBSERVER}`]: new Uint8Array([0, 0, 0]),
      },
    );

    // Every unexplored cell (state 0) produces identical opaque fog
    // [6, 10, 18, 255], regardless of surface, height, or paved road.
    expect(Array.from(composite(map, snap))).toEqual([
      6, 10, 18, 255, 6, 10, 18, 255, 6, 10, 18, 255,
    ]);

    // Missing vision layer in a snapshot hides the entire map identically.
    const snapNoVision = makeSnapshot(
      {},
      {
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
        [ROAD_LAYER_ID]: roads,
      },
    );
    expect(Array.from(composite(map, snapNoVision))).toEqual([
      6, 10, 18, 255, 6, 10, 18, 255, 6, 10, 18, 255,
    ]);

    // No snapshot at all: vision layer is null → all fog.
    expect(Array.from(composite(map, null))).toEqual([
      6, 10, 18, 255, 6, 10, 18, 255, 6, 10, 18, 255,
    ]);
  });

  it('dims explored cells (state 1) and highlights roads on visible cells', () => {
    const map = makeTestMap(2, 1);
    // Uniform flat ground (#5a8f3c -> 90, 143, 60)
    const snap = makeSnapshot(
      {},
      {
        [ROAD_LAYER_ID]: new Uint8Array([0, 1]),
        [`${VISION_STATE_LAYER_ID}#${OBSERVER}`]: new Uint8Array([1, 2]),
      },
    );
    const rgba = composite(map, snap);
    // Cell 0: state 1, no road -> Math.round(c * 0.45 + 8)
    expect(Array.from(rgba.slice(0, 4))).toEqual([
      Math.round(90 * 0.45 + 8),
      Math.round(143 * 0.45 + 8),
      Math.round(60 * 0.45 + 8),
      255,
    ]);
    // Cell 1: state 2, paved road -> 55% blend toward [150, 166, 188]
    expect(Array.from(rgba.slice(4, 8))).toEqual([
      Math.round(90 * 0.45 + 150 * 0.55),
      Math.round(143 * 0.45 + 166 * 0.55),
      Math.round(60 * 0.45 + 188 * 0.55),
      255,
    ]);
  });
});

describe('minimap mark contributions', () => {
  it('collects nothing when the snapshot is null', () => {
    const map = makeTestMap(1, 1);
    for (const def of MINIMAP_MARKS) {
      expect(
        def.collect({
          db,
          map,
          snapshot: null,
          isHostile,
          selected: new Set([1]),
          nowMs: 0,
        }),
        `marks from ${def.id}`,
      ).toEqual([]);
    }
  });
});
