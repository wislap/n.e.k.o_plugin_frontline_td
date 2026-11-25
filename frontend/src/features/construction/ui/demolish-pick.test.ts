// Demolishable-target picking (ADR 0048/0062): cancellable own
// structures and road segments by ground point and by 3D ray. Cases
// moved verbatim from client/pick.test.ts.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { loadContent } from '../../../content/index';
import {
  RoadWorksChannel,
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_OPERATIONAL,
  StructuresChannel,
  type ConstructionStructures,
  type RoadWorks,
} from '../protocol';
import { pickDemolishableAt, pickDemolishableByRay } from './demolish-pick';

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

describe('3D ray-volume demolish picking', () => {
  it('picks the tall structure the ray hits ahead of the ground point', () => {
    const heights = new Uint8Array(MAP_DIMS.width * MAP_DIMS.height);
    const snap = snapshot({ [StructuresChannel.id]: ownDepot });
    // Depot sits at [10..12, 0..1.0, 10..12]; aim ray through y = 0.7 at x=11, z=11
    // from pitch ~28°, hitting the flat floor behind the depot at (11, 9.68).
    const ray = {
      origin: { x: 11, y: 3.36, z: 16 },
      dir: { x: 0, y: -2.66, z: -5 },
    };
    const demolishable = pickDemolishableByRay(
      db,
      MAP_DIMS,
      heights,
      0.5,
      ray,
      { x: 11, y: 9.68 },
      snap,
      OBSERVER,
    );
    expect(demolishable?.handle).toBe(100);
  });
});
