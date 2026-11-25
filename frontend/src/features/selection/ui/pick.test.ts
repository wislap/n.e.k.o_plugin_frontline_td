// Selection and subject picking priority (ADR 0048).
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { loadContent } from '../../../content/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  STATE_OPERATIONAL,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../../construction/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../../vision/protocol';
import { pickAt, pickSubjectAt } from './pick';
import { pickSubjectByRay } from './pick-ray';

const db = loadContent();
const DEPOT = db.structures.byId('frontline_td:supply_depot');
if (DEPOT === undefined) {
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

describe('3D ray-volume picking', () => {
  it('picks elevated units and tall structures from shallow-pitch rays even when groundBehind misses', () => {
    const heights = new Uint8Array(MAP_DIMS.width * MAP_DIMS.height);
    const snap = snapshot({ [StructuresChannel.id]: ownDepot });
    // Depot sits at [10..12, 0..1.0, 10..12]; aim ray through y = 0.7 at x=11, z=11
    // from pitch ~28°, hitting the flat floor behind the depot at (11, 9.68).
    const ray = {
      origin: { x: 11, y: 3.36, z: 16 },
      dir: { x: 0, y: -2.66, z: -5 },
    };
    const pickedStruct = pickSubjectByRay(
      db,
      MAP_DIMS,
      heights,
      0.5,
      ray,
      { x: 11, y: 9.68 },
      snap,
      OBSERVER,
      new Map(),
    );
    expect(pickedStruct).toEqual({
      ownHandle: 100,
      subject: { kind: 'own_structure', handle: 100 },
    });

    // Same ray clipped by a closer cliff groundHit in front (z = 13) ignores the depot behind it.
    const occluded = pickSubjectByRay(
      db,
      MAP_DIMS,
      heights,
      0.5,
      ray,
      { x: 11, y: 13 },
      snap,
      OBSERVER,
      new Map(),
    );
    expect(occluded).toEqual({ ownHandle: null, subject: { kind: 'cell', x: 11, y: 13 } });

    // Unit cylinder pick works when cursor ray grazes the top of a unit.
    const units = new Map([[77, { x: 20, y: 20, faction: OBSERVER }]]);
    const unitRay = {
      origin: { x: 20, y: 3, z: 25 },
      dir: { x: 0, y: -2.5, z: -5 },
    };
    expect(
      pickSubjectByRay(
        db,
        MAP_DIMS,
        heights,
        0.5,
        unitRay,
        { x: 20, y: 19 },
        null,
        OBSERVER,
        units,
      ),
    ).toEqual({ ownHandle: 77, subject: { kind: 'own_unit', handle: 77 } });
  });
});
