// Selection and subject picking priority (ADR 0048).
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../core/index';
import { loadContent } from '../content/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_OPERATIONAL,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../features/construction/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../features/vision/protocol';
import { pickAt, pickDemolishableAt, pickSubjectAt } from './pick';

const db = loadContent();
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const MAIN_BASE = db.structures.byId('frontline_td:main_base');
if (DEPOT === undefined || MAIN_BASE === undefined) {
  throw new Error('structures missing');
}
const OBSERVER = 1;
const MAP_DIMS = { width: 64, height: 64 };

function snapshot(channels: Snapshot['channels']): Snapshot {
  return {
    tick: toTick(0),
    observer: toFactionId(OBSERVER),
    channels,
    events: [],
    layers: {},
    changedLayers: [],
  };
}

const ownDepot: ConstructionStructures = {
  handles: Float64Array.from([100]),
  kind: Uint16Array.from([DEPOT.index]),
  x: Uint16Array.from([10]),
  y: Uint16Array.from([10]),
  faction: Uint16Array.from([OBSERVER]),
  state: Uint8Array.from([STATE_OPERATIONAL]),
  progressBp: new Uint16Array(1).fill(10000),
  hpBp: new Uint16Array(1).fill(10000),
};

describe('pickAt', () => {
  it('prefers an own unit inside the radius over a structure', () => {
    const units = new Map([[7, { x: 11, y: 11, faction: OBSERVER }]]);
    const pick = pickAt(
      db,
      snapshot({ [StructuresChannel.id]: ownDepot }),
      OBSERVER,
      units,
      11,
      11,
    );
    expect(pick).toBe(7);
  });

  it('falls back to the structure when no unit is near', () => {
    const units = new Map([[7, { x: 30, y: 30, faction: OBSERVER }]]);
    const pick = pickAt(
      db,
      snapshot({ [StructuresChannel.id]: ownDepot }),
      OBSERVER,
      units,
      11,
      11,
    );
    expect(pick).toBe(100);
  });

  it('ignores enemy units and enemy structures', () => {
    const enemy: ConstructionStructures = {
      ...ownDepot,
      faction: Uint16Array.from([2]),
    };
    const units = new Map([[7, { x: 11, y: 11, faction: 2 }]]);
    expect(
      pickAt(db, snapshot({ [StructuresChannel.id]: enemy }), OBSERVER, units, 11, 11),
    ).toBeNull();
  });

  it('picks nearby salvage when nothing else matches', () => {
    const salvage: ConstructionSalvage = {
      handles: Float64Array.from([55]),
      x: Float32Array.from([20.5]),
      y: Float32Array.from([20.5]),
    };
    const pick = pickAt(
      db,
      snapshot({ [SalvageChannel.id]: salvage }),
      OBSERVER,
      new Map(),
      20.6,
      20.6,
    );
    expect(pick).toBe(55);
  });
});

describe('pickSubjectAt', () => {
  it('returns null subject when coordinates are out of bounds', () => {
    expect(pickSubjectAt(db, MAP_DIMS, null, OBSERVER, new Map(), -0.1, 5)).toEqual({
      ownHandle: null,
      subject: null,
    });
    expect(pickSubjectAt(db, MAP_DIMS, null, OBSERVER, new Map(), 64, 5)).toEqual({
      ownHandle: null,
      subject: null,
    });
  });

  it('prefers own unit over hostile unit on exact distance tie', () => {
    const units = new Map([
      [11, { x: 10.2, y: 10.0, faction: 2 }],
      [12, { x: 10.2, y: 10.0, faction: OBSERVER }],
    ]);
    expect(pickSubjectAt(db, MAP_DIMS, null, OBSERVER, units, 10.2, 10.0)).toEqual({
      ownHandle: 12,
      subject: { kind: 'own_unit', handle: 12 },
    });
  });

  it('returns hostile_unit with null ownHandle when nearest unit is hostile', () => {
    const units = new Map([[11, { x: 10.2, y: 10.0, faction: 2 }]]);
    expect(
      pickSubjectAt(
        db,
        MAP_DIMS,
        snapshot({ [StructuresChannel.id]: ownDepot }),
        OBSERVER,
        units,
        10.2,
        10.0,
      ),
    ).toEqual({
      ownHandle: null,
      subject: { kind: 'hostile_unit', handle: 11 },
    });
  });

  it('distinguishes own_structure, hostile_structure, and ruin', () => {
    const mixed: ConstructionStructures = {
      handles: Float64Array.from([100, 101, 102]),
      kind: Uint16Array.from([DEPOT.index, DEPOT.index, DEPOT.index]),
      x: Uint16Array.from([10, 20, 30]),
      y: Uint16Array.from([10, 10, 10]),
      faction: Uint16Array.from([OBSERVER, 2, 0]),
      state: Uint8Array.from([STATE_OPERATIONAL, STATE_OPERATIONAL, STATE_RUIN]),
      progressBp: Uint16Array.from([10000, 10000, 0]),
      hpBp: Uint16Array.from([10000, 10000, 0]),
    };
    const snap = snapshot({ [StructuresChannel.id]: mixed });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 10.5, 10.5)).toEqual({
      ownHandle: 100,
      subject: { kind: 'own_structure', handle: 100 },
    });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 20.5, 10.5)).toEqual({
      ownHandle: null,
      subject: { kind: 'hostile_structure', handle: 101 },
    });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 30.5, 10.5)).toEqual({
      ownHandle: null,
      subject: { kind: 'ruin', handle: 102 },
    });
  });

  it('picks road_segment (own) and salvage (non-own) within radius', () => {
    const roadWorks: RoadWorks = {
      segments: {
        handles: Float64Array.from([201]),
        x: Float32Array.from([15]),
        y: Float32Array.from([15]),
        progressBp: Uint16Array.from([5000]),
        hpBp: Uint16Array.from([10000]),
      },
      projects: {
        offsets: Uint32Array.from([0]),
        cells: Uint32Array.from([]),
        built: Uint16Array.from([]),
        level: Uint8Array.from([]),
      },
    };
    const salvage: ConstructionSalvage = {
      handles: Float64Array.from([202]),
      x: Float32Array.from([25]),
      y: Float32Array.from([25]),
    };
    const snap = snapshot({
      [RoadWorksChannel.id]: roadWorks,
      [SalvageChannel.id]: salvage,
    });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 15.2, 15.2)).toEqual({
      ownHandle: 201,
      subject: { kind: 'road_segment', handle: 201 },
    });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 25.2, 25.2)).toEqual({
      ownHandle: null,
      subject: { kind: 'salvage', handle: 202 },
    });
  });

  it('picks fog memory structures and falls back to terrain cell', () => {
    const memory: VisionMemory = {
      handles: Float64Array.from([301]),
      kind: Uint16Array.from([DEPOT.index]),
      x: Uint16Array.from([40]),
      y: Uint16Array.from([40]),
      faction: Uint16Array.from([2]),
      state: Uint8Array.from([STATE_OPERATIONAL]),
    };
    const snap = snapshot({ [VisionMemoryChannel.id]: memory });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 40.4, 40.4)).toEqual({
      ownHandle: null,
      subject: {
        kind: 'memory',
        handle: 301,
        kindIndex: DEPOT.index,
        x: 40,
        y: 40,
        faction: 2,
        state: STATE_OPERATIONAL,
      },
    });
    expect(pickSubjectAt(db, MAP_DIMS, snap, OBSERVER, new Map(), 5.7, 8.9)).toEqual({
      ownHandle: null,
      subject: { kind: 'cell', x: 5, y: 8 },
    });
  });
});

describe('pickDemolishableAt', () => {
  it('returns handle and refunds for cancellable own structures and road segments', () => {
    const structures: ConstructionStructures = {
      handles: Float64Array.from([100, 101, 102, 103]),
      kind: Uint16Array.from([DEPOT.index, MAIN_BASE.index, DEPOT.index, DEPOT.index]),
      x: Uint16Array.from([10, 20, 30, 40]),
      y: Uint16Array.from([10, 10, 10, 10]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, OBSERVER, 2]),
      state: Uint8Array.from([
        STATE_OPERATIONAL,
        STATE_OPERATIONAL,
        STATE_BLUEPRINT,
        STATE_OPERATIONAL,
      ]),
      progressBp: Uint16Array.from([10000, 10000, 0, 10000]),
      hpBp: Uint16Array.from([10000, 10000, 10000, 10000]),
    };
    const roadWorks: RoadWorks = {
      segments: {
        handles: Float64Array.from([201]),
        x: Float32Array.from([50]),
        y: Float32Array.from([50]),
        progressBp: Uint16Array.from([2000]),
        hpBp: Uint16Array.from([10000]),
      },
      projects: {
        offsets: Uint32Array.from([0]),
        cells: Uint32Array.from([]),
        built: Uint16Array.from([]),
        level: Uint8Array.from([]),
      },
    };
    const snap = snapshot({
      [StructuresChannel.id]: structures,
      [RoadWorksChannel.id]: roadWorks,
    });

    const depotPick = pickDemolishableAt(db, snap, OBSERVER, 10.5, 10.5);
    expect(depotPick).not.toBeNull();
    expect(depotPick?.handle).toBe(100);
    expect(depotPick?.refunds.length).toBeGreaterThan(0);

    // Non-buildable main_base is not demolishable.
    expect(pickDemolishableAt(db, snap, OBSERVER, 20.5, 10.5)).toBeNull();
    // Own blueprint is cancellable with empty refunds.
    expect(pickDemolishableAt(db, snap, OBSERVER, 30.5, 10.5)).toEqual({
      handle: 102,
      refunds: [],
    });
    // Enemy structure is ignored.
    expect(pickDemolishableAt(db, snap, OBSERVER, 40.5, 10.5)).toBeNull();
    // Road segment within radius is cancellable.
    expect(pickDemolishableAt(db, snap, OBSERVER, 50.2, 50.2)).toEqual({
      handle: 201,
      refunds: [],
    });
  });

  it('returns null for already-demolishing structures', () => {
    const demolishing: ConstructionStructures = {
      handles: Float64Array.from([100]),
      kind: Uint16Array.from([DEPOT.index]),
      x: Uint16Array.from([10]),
      y: Uint16Array.from([10]),
      faction: Uint16Array.from([OBSERVER]),
      state: Uint8Array.from([STATE_DEMOLISHING]),
      progressBp: Uint16Array.from([5000]),
      hpBp: Uint16Array.from([10000]),
    };
    expect(
      pickDemolishableAt(
        db,
        snapshot({ [StructuresChannel.id]: demolishing }),
        OBSERVER,
        10.5,
        10.5,
      ),
    ).toBeNull();
  });
});
