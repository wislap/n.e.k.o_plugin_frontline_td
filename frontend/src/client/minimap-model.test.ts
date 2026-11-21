// Minimap model tests: projection round-trips and clamping, terrain
// RGB/cliff shading, strict fog-of-war non-leakage, entity collection,
// and spectate/tactical viewport projection parity.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../core/index';
import { loadContent, type ResolvedMap } from '../content/index';
import { CapturePointsChannel, type CapturePoints } from '../features/capture/protocol';
import {
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionStructures,
} from '../features/construction/protocol';
import { SquadsChannel, type SquadsSnapshot } from '../features/squads/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../features/terrain/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../features/units/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../features/vision/protocol';
import { matchZoomForMode } from './camera-math';
import { makeIsHostile } from './hostility';
import {
  buildBaseTerrainRgb,
  canvasToMap,
  collectMinimapEntities,
  compositeMinimapTerrainRgba,
  computeMinimapViewport,
  mapToCanvas,
} from './minimap-model';

const db = loadContent();
const GROUND = db.surfaces.byId('frontline_td:ground');
const DEEP_WATER = db.surfaces.byId('frontline_td:deep_water');
const ORE_FIELD = db.surfaces.byId('frontline_td:ore_field');
const MAIN_BASE = db.structures.byId('frontline_td:main_base');
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const OUTPOST = db.structures.byId('frontline_td:outpost');
const TURRET = db.structures.byId('frontline_td:turret');

if (
  GROUND === undefined ||
  DEEP_WATER === undefined ||
  ORE_FIELD === undefined ||
  MAIN_BASE === undefined ||
  DEPOT === undefined ||
  OUTPOST === undefined ||
  TURRET === undefined
) {
  throw new Error('required content missing');
}

const OBSERVER = 1;
const ENEMY = 2;
const ALLY = 3;
const isHostile = makeIsHostile([
  { a: toFactionId(OBSERVER), b: toFactionId(ENEMY), relation: 'hostile' },
  { a: toFactionId(OBSERVER), b: toFactionId(ALLY), relation: 'allied' },
]);

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

describe('canvasToMap & mapToCanvas', () => {
  it('round-trips interior points accurately', () => {
    const mapPt = canvasToMap(75, 45, 200, 120, 64, 48);
    expect(mapPt.x).toBeCloseTo(24, 5);
    expect(mapPt.y).toBeCloseTo(18, 5);

    const back = mapToCanvas(mapPt.x, mapPt.y, 200, 120, 64, 48);
    expect(back.x).toBeCloseTo(75, 5);
    expect(back.y).toBeCloseTo(45, 5);
  });

  it('clamps out-of-bounds pixels so Math.floor stays in [0 .. dim - 1]', () => {
    const neg = canvasToMap(-5, -5, 200, 160, 64, 48);
    expect(neg.x).toBe(0);
    expect(neg.y).toBe(0);
    expect(Math.floor(neg.x)).toBe(0);
    expect(Math.floor(neg.y)).toBe(0);

    const edge = canvasToMap(200, 160, 200, 160, 64, 48);
    expect(Math.floor(edge.x)).toBe(63);
    expect(Math.floor(edge.y)).toBe(47);

    const over = canvasToMap(500, 500, 200, 160, 64, 48);
    expect(Math.floor(over.x)).toBe(63);
    expect(Math.floor(over.y)).toBe(47);
  });

  it('handles zero or non-positive canvas and map sizes safely', () => {
    const zeroW = canvasToMap(10, 10, 0, 100, 64, 48);
    expect(zeroW.x).toBe(0);
    expect(zeroW.y).toBeCloseTo(4.8, 6);
    const zeroH = canvasToMap(10, 10, 100, 0, 64, 48);
    expect(zeroH.x).toBeCloseTo(6.4, 6);
    expect(zeroH.y).toBe(0);
    expect(canvasToMap(10, 10, 100, 100, 0, 0)).toEqual({ x: 0, y: 0 });
    const mapZeroW = mapToCanvas(10, 10, 0, 100, 64, 48);
    expect(mapZeroW.x).toBe(0);
    expect(mapZeroW.y).toBeCloseTo(20.833333, 5);
    expect(mapToCanvas(10, 10, 100, 100, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('buildBaseTerrainRgb & compositeMinimapTerrainRgba', () => {
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

  it('enforces strict fog non-leakage on unexplored cells and null visionLayer', () => {
    const map = makeTestMap(3, 1);
    const surfaces = new Uint16Array([ORE_FIELD.index, GROUND.index, DEEP_WATER.index]);
    const heights = new Uint8Array([0, 2, 1]);
    const roads = new Uint8Array([1, 1, 1]);
    const snap = makeSnapshot(
      {},
      {
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
      },
    );
    const baseRgb = buildBaseTerrainRgb(db, map, snap);

    // Every unexplored cell (state 0) produces identical opaque fog [6, 10, 18, 255],
    // regardless of underlying surface, height, or paved road.
    const visionZero = new Uint8Array([0, 0, 0]);
    const rgbaZero = compositeMinimapTerrainRgba(baseRgb, 3, visionZero, roads);
    expect(Array.from(rgbaZero)).toEqual([6, 10, 18, 255, 6, 10, 18, 255, 6, 10, 18, 255]);

    // Null visionLayer hides the entire map identically.
    const outBuf = new Uint8ClampedArray(12);
    const rgbaNull = compositeMinimapTerrainRgba(baseRgb, 3, null, roads, outBuf);
    expect(rgbaNull).toBe(outBuf);
    expect(Array.from(rgbaNull)).toEqual([6, 10, 18, 255, 6, 10, 18, 255, 6, 10, 18, 255]);
  });

  it('dims explored cells (state 1) and highlights roads on visible/explored cells', () => {
    const map = makeTestMap(2, 1);
    // Uniform flat ground (#5a8f3c -> 90, 143, 60)
    const baseRgb = buildBaseTerrainRgb(db, map);
    const vision = new Uint8Array([1, 2]);
    const roads = new Uint8Array([0, 1]);

    const rgba = compositeMinimapTerrainRgba(baseRgb, 2, vision, roads);
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

    // Undefined visionLayer treats all cells as visible (state 2).
    const rgbaVisible = compositeMinimapTerrainRgba(baseRgb, 2, undefined, undefined);
    expect(Array.from(rgbaVisible.slice(0, 4))).toEqual([90, 143, 60, 255]);
  });
});

describe('collectMinimapEntities', () => {
  it('returns empty collections when snapshot is null', () => {
    expect(collectMinimapEntities(db, null, isHostile, new Set([1]))).toEqual({
      memories: [],
      structures: [],
      units: [],
      threats: [],
    });
  });

  it('collects memories, structures joined with capture points, units, and hostile threat routes', () => {
    const memory: VisionMemory = {
      handles: Float64Array.from([10, 11, 12]),
      kind: Uint16Array.from([DEPOT.index, OUTPOST.index, TURRET.index]),
      x: Uint16Array.from([4, 8, 12]),
      y: Uint16Array.from([5, 9, 13]),
      faction: Uint16Array.from([ENEMY, 0, ALLY]),
      state: Uint8Array.from([STATE_OPERATIONAL, STATE_RUIN, STATE_OPERATIONAL]),
    };

    const structures: ConstructionStructures = {
      handles: Float64Array.from([20, 21, 22, 23]),
      kind: Uint16Array.from([MAIN_BASE.index, DEPOT.index, TURRET.index, OUTPOST.index]),
      x: Uint16Array.from([2, 6, 20, 30]),
      y: Uint16Array.from([2, 6, 20, 30]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, ENEMY, 0]),
      state: Uint8Array.from([STATE_OPERATIONAL, STATE_BLUEPRINT, STATE_OPERATIONAL, STATE_RUIN]),
      progressBp: Uint16Array.from([10000, 0, 10000, 0]),
      hpBp: Uint16Array.from([10000, 10000, 8000, 0]),
    };

    const capturePoints: CapturePoints = {
      handles: Float64Array.from([23]),
      x: Float32Array.from([31]),
      y: Float32Array.from([31]),
      radius: Float32Array.from([4]),
      owner: Uint16Array.from([0]),
      progressBp: Uint16Array.from([4500]),
      leader: Uint16Array.from([OBSERVER]),
      contested: Uint8Array.from([1]),
    };

    const units: DenseUnits = {
      handles: Float64Array.from([100, 101, 102, 103]),
      x: Float32Array.from([3.5, 4.5, 18.5, 19.5]),
      y: Float32Array.from([3.5, 4.5, 18.5, 19.5]),
      kind: Uint16Array.from([0, 0, 0, 0]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, ENEMY, ALLY]),
      moving: Uint8Array.from([0, 1, 1, 0]),
      hpBp: Uint16Array.from([10000, 10000, 9000, 10000]),
      energyBp: Uint16Array.from([10000, 10000, 0xffff, 10000]),
    };

    const squads: SquadsSnapshot = {
      squads: [
        {
          id: 1,
          faction: ENEMY,
          memberCount: 4,
          strength: 4,
          order: { kind: 'gather', x: 25, y: 26, radius: 2, targetX: 4, targetY: 4 },
          phase: 'gather',
          centroid: { x: 25, y: 26 },
          route: [25.5, 26.5, 14.5, 14.5, 4.5, 4.5],
        },
        {
          id: 2,
          faction: ENEMY,
          memberCount: 3,
          strength: 3,
          order: { kind: 'advance', x: 4, y: 4, radius: 2 },
          phase: 'advance',
          centroid: { x: 18, y: 18 },
        },
        {
          id: 3,
          faction: ENEMY,
          memberCount: 2,
          strength: 2,
          order: { kind: 'guard', x: 22, y: 22, radius: 3 },
          phase: 'guard',
          centroid: { x: 22, y: 22 },
        },
        {
          id: 4,
          faction: ALLY,
          memberCount: 2,
          strength: 2,
          order: { kind: 'advance', x: 10, y: 10, radius: 2 },
          phase: 'advance',
          centroid: { x: 9, y: 9 },
        },
      ],
    };

    const snap = makeSnapshot({
      [VisionMemoryChannel.id]: memory,
      [StructuresChannel.id]: structures,
      [CapturePointsChannel.id]: capturePoints,
      [DenseUnitsChannel.id]: units,
      [SquadsChannel.id]: squads,
    });

    // Include enemy handle 102 in selected set to ensure only own units mark selected.
    const entities = collectMinimapEntities(db, snap, isHostile, new Set([100, 102]));

    expect(entities.memories).toEqual([
      { x: 4, y: 5, w: DEPOT.footprint.w, h: DEPOT.footprint.h, disposition: 'hostile' },
      { x: 8, y: 9, w: OUTPOST.footprint.w, h: OUTPOST.footprint.h, disposition: 'neutral' },
      { x: 12, y: 13, w: TURRET.footprint.w, h: TURRET.footprint.h, disposition: 'ally' },
    ]);

    expect(entities.structures).toEqual([
      {
        x: 2,
        y: 2,
        w: MAIN_BASE.footprint.w,
        h: MAIN_BASE.footprint.h,
        disposition: 'own',
        isCore: true,
        isBlueprint: false,
        contested: false,
        captureLeaderDisposition: 'none',
      },
      {
        x: 6,
        y: 6,
        w: DEPOT.footprint.w,
        h: DEPOT.footprint.h,
        disposition: 'own',
        isCore: false,
        isBlueprint: true,
        contested: false,
        captureLeaderDisposition: 'none',
      },
      {
        x: 20,
        y: 20,
        w: TURRET.footprint.w,
        h: TURRET.footprint.h,
        disposition: 'hostile',
        isCore: false,
        isBlueprint: false,
        contested: false,
        captureLeaderDisposition: 'none',
      },
      {
        x: 30,
        y: 30,
        w: OUTPOST.footprint.w,
        h: OUTPOST.footprint.h,
        disposition: 'ruin',
        isCore: false,
        isBlueprint: false,
        contested: true,
        captureLeaderDisposition: 'own',
      },
    ]);

    expect(entities.units).toEqual([
      { x: 3.5, y: 3.5, disposition: 'own', selected: true },
      { x: 4.5, y: 4.5, disposition: 'own', selected: false },
      { x: 18.5, y: 18.5, disposition: 'hostile', selected: false },
      { x: 19.5, y: 19.5, disposition: 'ally', selected: false },
    ]);

    expect(entities.threats).toEqual([
      {
        kind: 'gather',
        gatherX: 25,
        gatherY: 26,
        route: [25.5, 26.5, 14.5, 14.5, 4.5, 4.5],
      },
      {
        kind: 'advance',
        gatherX: 4,
        gatherY: 4,
        route: [],
      },
    ]);
  });
});

describe('computeMinimapViewport', () => {
  it('preserves vertical ground span across spectate and tactical via matchZoomForMode', () => {
    const spectateZoom = 34;
    const tacticalZoom = matchZoomForMode('tactical', spectateZoom);
    const aspect = 16 / 9;

    const spectateRect = computeMinimapViewport('spectate', { x: 40, y: 30 }, spectateZoom, aspect);
    const tacticalRect = computeMinimapViewport('tactical', { x: 40, y: 30 }, tacticalZoom, aspect);

    expect(tacticalRect.h).toBeCloseTo(spectateRect.h, 6);
    expect(tacticalRect.x + tacticalRect.w / 2).toBeCloseTo(40, 6);
    expect(tacticalRect.y + tacticalRect.h / 2).toBeCloseTo(30, 6);
    expect(spectateRect.x + spectateRect.w / 2).toBeCloseTo(40, 6);
    expect(spectateRect.y + spectateRect.h / 2).toBeCloseTo(30, 6);
  });

  it('falls back to 16:9 aspect when viewportAspect is invalid or non-positive', () => {
    const fallback = computeMinimapViewport('tactical', { x: 20, y: 20 }, 24, 0);
    const explicit = computeMinimapViewport('tactical', { x: 20, y: 20 }, 24, 16 / 9);
    expect(fallback).toEqual(explicit);
    expect(fallback.w).toBeCloseTo(24 * (16 / 9), 6);
    expect(fallback.h).toBe(24);
  });
});
