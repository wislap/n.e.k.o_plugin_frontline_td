// Inspector subject resolver tests (ADR 0048): covers multi-selection
// breakdown, strict fog-of-war hiding on unexplored cells, terrain/coverage/
// exclusion on explored cells, own vs hostile entity guards, ruins,
// salvage, road segments, and vision memory.
import { describe, expect, it } from 'vitest';
import { packHandle, toFactionId, toTick, type Inspection, type Snapshot } from '../core/index';
import { loadContent } from '../content/index';
import { CapturePointsChannel, type CapturePoints } from '../features/capture/protocol';
import { COMBAT_INSPECTOR_ID } from '../features/combat/protocol';
import {
  CONSTRUCTION_INSPECTOR_ID,
  RoadWorksChannel,
  SalvageChannel,
  STATE_OPERATIONAL,
  STATE_RUIN,
  STATE_SITE,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../features/construction/protocol';
import {
  LOGISTICS_INSPECTOR_ID,
  ROAD_LAYER_ID,
  SERVICE_LAYER_ID,
} from '../features/logistics/protocol';
import { PRODUCTION_INSPECTOR_ID } from '../features/production/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../features/terrain/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../features/units/protocol';
import {
  VISION_STATE_LAYER_ID,
  VisionMemoryChannel,
  type VisionMemory,
} from '../features/vision/protocol';
import { makeIsHostile } from './hostility';
import { resolveInspectedSubject } from './inspect-subject';

const db = loadContent();
const map = db.maps.list[0];
const ROBOT = db.units.byId('frontline_td:robot');
const RAIDER = db.units.byId('frontline_td:raider');
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const OUTPOST = db.structures.byId('frontline_td:outpost');
const TURRET = db.structures.byId('frontline_td:turret');
const ORE_SURFACE = db.surfaces.list.find((s) => s.deposit !== undefined);
if (
  map === undefined ||
  ROBOT === undefined ||
  RAIDER === undefined ||
  DEPOT === undefined ||
  OUTPOST === undefined ||
  TURRET === undefined ||
  ORE_SURFACE === undefined
) {
  throw new Error('required content missing');
}

const OBSERVER = 1;
const ENEMY = 2;
const isHostile = makeIsHostile([
  { a: toFactionId(OBSERVER), b: toFactionId(ENEMY), relation: 'hostile' },
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

describe('resolveInspectedSubject', () => {
  it('computes sorted per-kind breakdown for multi_own', () => {
    const units: DenseUnits = {
      handles: Float64Array.from([1, 2, 3]),
      x: Float32Array.from([5, 6, 7]),
      y: Float32Array.from([5, 6, 7]),
      kind: Uint16Array.from([ROBOT.index, ROBOT.index, RAIDER.index]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, OBSERVER]),
      moving: Uint8Array.from([0, 1, 0]),
      hpBp: Uint16Array.from([10000, 10000, 10000]),
      energyBp: Uint16Array.from([10000, 8000, 0xffff]),
    };
    const structures: ConstructionStructures = {
      handles: Float64Array.from([10, 11, 12]),
      kind: Uint16Array.from([DEPOT.index, DEPOT.index, TURRET.index]),
      x: Uint16Array.from([1, 4, 8]),
      y: Uint16Array.from([1, 4, 8]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, OBSERVER]),
      state: Uint8Array.from([STATE_OPERATIONAL, STATE_OPERATIONAL, STATE_OPERATIONAL]),
      progressBp: Uint16Array.from([10000, 10000, 10000]),
      hpBp: Uint16Array.from([10000, 10000, 10000]),
    };
    const view = resolveInspectedSubject({
      db,
      map,
      snapshot: makeSnapshot({
        [DenseUnitsChannel.id]: units,
        [StructuresChannel.id]: structures,
      }),
      isHostile,
      subject: { kind: 'multi_own', count: 5 },
      selected: new Set([1, 2, 3, 10, 11]),
      inspection: null,
    });
    expect(view).toEqual({
      kind: 'multi_own',
      count: 5,
      breakdown: [
        { category: 'structure', contentId: DEPOT.id, count: 2 },
        { category: 'unit', contentId: ROBOT.id, count: 2 },
        { category: 'unit', contentId: RAIDER.id, count: 1 },
      ],
    });
  });

  it('hides all terrain, deposit, road, and coverage details on unexplored fog cells', () => {
    const size = map.width * map.height;
    const fog = new Uint8Array(size); // 0 = unexplored everywhere
    const surfaces = new Uint16Array(size).fill(ORE_SURFACE.index);
    const heights = new Uint8Array(size).fill(7);
    const roads = new Uint8Array(size).fill(2);
    const service = new Uint8Array(size).fill(1);
    const snap = makeSnapshot(
      {},
      {
        [`${VISION_STATE_LAYER_ID}#${OBSERVER}`]: fog,
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
        [ROAD_LAYER_ID]: roads,
        [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service,
      },
    );
    const view = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'cell', x: 4, y: 5 },
      selected: new Set(),
      inspection: null,
    });
    expect(view).toEqual({ kind: 'cell_unexplored', x: 4, y: 5 });
  });

  it('reads surface, deposit, height, ramp, road, coverage, and hostile exclusion on explored cells', () => {
    const size = map.width * map.height;
    const fog = new Uint8Array(size).fill(1);
    const cellX = 10;
    const cellY = 10;
    const idx = cellY * map.width + cellX;
    fog[idx] = 2;
    const surfaces = new Uint16Array(size).fill(ORE_SURFACE.index);
    const heights = new Uint8Array(size).fill(3);
    const roads = new Uint8Array(size);
    roads[idx] = 1;
    const service = new Uint8Array(size);
    service[idx] = 1;
    const hostileOutpost: ConstructionStructures = {
      handles: Float64Array.from([500]),
      kind: Uint16Array.from([OUTPOST.index]),
      x: Uint16Array.from([12]),
      y: Uint16Array.from([10]),
      faction: Uint16Array.from([ENEMY]),
      state: Uint8Array.from([STATE_OPERATIONAL]),
      progressBp: Uint16Array.from([10000]),
      hpBp: Uint16Array.from([10000]),
    };
    const snap = makeSnapshot(
      { [StructuresChannel.id]: hostileOutpost },
      {
        [`${VISION_STATE_LAYER_ID}#${OBSERVER}`]: fog,
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
        [ROAD_LAYER_ID]: roads,
        [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service,
      },
    );
    const view = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'cell', x: cellX, y: cellY },
      selected: new Set(),
      inspection: null,
    });
    const depositCargoId =
      ORE_SURFACE.deposit !== undefined
        ? (db.cargos.byIndex(ORE_SURFACE.deposit)?.id ?? null)
        : null;
    expect(view).toEqual({
      kind: 'cell',
      x: cellX,
      y: cellY,
      visionState: 2,
      surfaceId: ORE_SURFACE.id,
      depositId: depositCargoId,
      height: 3,
      isRamp: (map.grid.ramps[idx] ?? 0) !== 0,
      roadLevel: 1,
      covered: true,
      excluded: true,
    });
  });

  it('attaches inspection sections only for matching own_unit and never for hostile_unit', () => {
    const units: DenseUnits = {
      handles: Float64Array.from([1, 2]),
      x: Float32Array.from([5, 6]),
      y: Float32Array.from([5, 6]),
      kind: Uint16Array.from([ROBOT.index, RAIDER.index]),
      faction: Uint16Array.from([OBSERVER, ENEMY]),
      moving: Uint8Array.from([1, 0]),
      hpBp: Uint16Array.from([7500, 9000]),
      energyBp: Uint16Array.from([5000, 0xffff]),
    };
    const snap = makeSnapshot({ [DenseUnitsChannel.id]: units });
    const ownInspection: Inspection = {
      handle: packHandle(1, 0),
      modifiers: [{ stat: 'speed', source: 'energy_low', op: 'mul_bp', value: 5000 }],
      sections: {
        [COMBAT_INSPECTOR_ID]: { hp: 75000, max: 100000, readyIn: 0 },
        [LOGISTICS_INSPECTOR_ID]: {
          slots: [],
          bottleneck: 0,
          attachedNode: null,
          node: null,
        },
      },
    };
    const ownView = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'own_unit', handle: 1 },
      selected: new Set([1]),
      inspection: ownInspection,
    });
    expect(ownView).toMatchObject({
      kind: 'own_unit',
      handle: 1,
      contentId: ROBOT.id,
      moving: true,
      hpBp: 7500,
      energyBp: 5000,
      hasInspection: true,
      combat: { hp: 75000, max: 100000, readyIn: 0 },
      modifiers: [{ stat: 'speed', source: 'energy_low', op: 'mul_bp', value: 5000 }],
    });

    // Stale inspection for a different handle must not attach to own_unit.
    const staleView = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'own_unit', handle: 1 },
      selected: new Set([1]),
      inspection: { ...ownInspection, handle: packHandle(99, 0) },
    });
    expect(staleView).toMatchObject({
      kind: 'own_unit',
      handle: 1,
      hasInspection: false,
      combat: null,
      logistics: null,
      modifiers: [],
    });

    // Even if an inspection object happens to match handle 2, hostile_unit never exposes it.
    const hostileInspection: Inspection = {
      handle: packHandle(2, 0),
      modifiers: [{ stat: 'speed', source: 'secret', op: 'mul_bp', value: 1 }],
      sections: { [COMBAT_INSPECTOR_ID]: { hp: 90, max: 100 } },
    };
    const hostileView = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'hostile_unit', handle: 2 },
      selected: new Set(),
      inspection: hostileInspection,
    });
    expect(hostileView).toEqual({
      kind: 'hostile_unit',
      handle: 2,
      contentId: RAIDER.id,
      faction: ENEMY,
      moving: false,
      hpBp: 9000,
      energyBp: null,
      unit: RAIDER,
    });
    expect('combat' in (hostileView ?? {})).toBe(false);
    expect('modifiers' in (hostileView ?? {})).toBe(false);
  });

  it('resolves own_structure with typed sections and hostile_structure without inspection', () => {
    const structures: ConstructionStructures = {
      handles: Float64Array.from([100, 101]),
      kind: Uint16Array.from([DEPOT.index, TURRET.index]),
      x: Uint16Array.from([10, 20]),
      y: Uint16Array.from([10, 20]),
      faction: Uint16Array.from([OBSERVER, ENEMY]),
      state: Uint8Array.from([STATE_SITE, STATE_OPERATIONAL]),
      progressBp: Uint16Array.from([4000, 10000]),
      hpBp: Uint16Array.from([10000, 8000]),
    };
    const snap = makeSnapshot({ [StructuresChannel.id]: structures });
    const insp: Inspection = {
      handle: packHandle(100, 0),
      modifiers: [],
      sections: {
        [CONSTRUCTION_INSPECTOR_ID]: {
          state: 'site',
          kind: DEPOT.id,
          x: 10,
          y: 10,
          progress: 40,
          total: 100,
          progressBp: 4000,
        },
        [PRODUCTION_INSPECTOR_ID]: {
          state: 'ready',
          progress: 0,
          total: 20,
          missing: [],
          full: [],
        },
      },
    };
    const ownStruct = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'own_structure', handle: 100 },
      selected: new Set([100]),
      inspection: insp,
    });
    expect(ownStruct).toMatchObject({
      kind: 'own_structure',
      handle: 100,
      contentId: DEPOT.id,
      stateName: 'site',
      progressBp: 4000,
      hasInspection: true,
      construction: { state: 'site', progressBp: 4000 },
      production: { state: 'ready', total: 20 },
    });

    const hostileStruct = resolveInspectedSubject({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'hostile_structure', handle: 101 },
      selected: new Set(),
      inspection: { handle: packHandle(101, 0), modifiers: [], sections: {} },
    });
    expect(hostileStruct).toEqual({
      kind: 'hostile_structure',
      handle: 101,
      contentId: TURRET.id,
      faction: ENEMY,
      x: 20,
      y: 20,
      stateName: 'operational',
      progressBp: 10000,
      hpBp: 8000,
      structure: TURRET,
    });
  });

  it('resolves ruins joined with CapturePointsChannel, salvage, road segments, and memory', () => {
    const structures: ConstructionStructures = {
      handles: Float64Array.from([300]),
      kind: Uint16Array.from([OUTPOST.index]),
      x: Uint16Array.from([30]),
      y: Uint16Array.from([30]),
      faction: Uint16Array.from([0]),
      state: Uint8Array.from([STATE_RUIN]),
      progressBp: Uint16Array.from([0]),
      hpBp: Uint16Array.from([0]),
    };
    const capturePoints: CapturePoints = {
      handles: Float64Array.from([300]),
      x: Float32Array.from([31]),
      y: Float32Array.from([31]),
      radius: Float32Array.from([4]),
      owner: Uint16Array.from([OBSERVER]),
      progressBp: Uint16Array.from([6500]),
      leader: Uint16Array.from([OBSERVER]),
      contested: Uint8Array.from([1]),
    };
    const salvage: ConstructionSalvage = {
      handles: Float64Array.from([400]),
      x: Float32Array.from([12.5]),
      y: Float32Array.from([14.5]),
    };
    const roadWorks: RoadWorks = {
      segments: {
        handles: Float64Array.from([500]),
        x: Float32Array.from([22.5]),
        y: Float32Array.from([24.5]),
        progressBp: Uint16Array.from([7500]),
        hpBp: Uint16Array.from([9000]),
      },
      projects: {
        offsets: Uint32Array.from([0]),
        cells: Uint32Array.from([]),
        built: Uint16Array.from([]),
        level: Uint8Array.from([]),
      },
    };
    const memory: VisionMemory = {
      handles: Float64Array.from([600]),
      kind: Uint16Array.from([DEPOT.index]),
      x: Uint16Array.from([44]),
      y: Uint16Array.from([45]),
      faction: Uint16Array.from([ENEMY]),
      state: Uint8Array.from([STATE_OPERATIONAL]),
    };
    const snap = makeSnapshot({
      [StructuresChannel.id]: structures,
      [CapturePointsChannel.id]: capturePoints,
      [SalvageChannel.id]: salvage,
      [RoadWorksChannel.id]: roadWorks,
      [VisionMemoryChannel.id]: memory,
    });

    expect(
      resolveInspectedSubject({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: { kind: 'ruin', handle: 300 },
        selected: new Set(),
        inspection: null,
      }),
    ).toEqual({
      kind: 'ruin',
      handle: 300,
      contentId: OUTPOST.id,
      x: 30,
      y: 30,
      structure: OUTPOST,
      progressBp: 6500,
      leader: OBSERVER,
      owner: OBSERVER,
      contested: true,
    });

    expect(
      resolveInspectedSubject({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: { kind: 'salvage', handle: 400 },
        selected: new Set(),
        inspection: null,
      }),
    ).toEqual({
      kind: 'salvage',
      handle: 400,
      x: 12.5,
      y: 14.5,
      construction: null,
      logistics: null,
      hasInspection: false,
    });

    expect(
      resolveInspectedSubject({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: { kind: 'road_segment', handle: 500 },
        selected: new Set(),
        inspection: null,
      }),
    ).toEqual({
      kind: 'road_segment',
      handle: 500,
      x: 22.5,
      y: 24.5,
      progressBp: 7500,
      hpBp: 9000,
      construction: null,
      logistics: null,
      combat: null,
      hasInspection: false,
    });

    expect(
      resolveInspectedSubject({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: {
          kind: 'memory',
          handle: 600,
          kindIndex: DEPOT.index,
          x: 44,
          y: 45,
          faction: ENEMY,
          state: STATE_OPERATIONAL,
        },
        selected: new Set(),
        inspection: null,
      }),
    ).toEqual({
      kind: 'memory',
      handle: 600,
      contentId: DEPOT.id,
      x: 44,
      y: 45,
      faction: ENEMY,
      stateName: 'operational',
      structure: DEPOT,
    });
  });
});
