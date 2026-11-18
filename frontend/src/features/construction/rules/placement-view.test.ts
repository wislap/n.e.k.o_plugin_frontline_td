// Snapshot-backed placement adapter (M3 D): the preview reads terrain
// layers, the blocked overlay, own blueprints, the service layer and
// completed nodes from the latest snapshot.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { loadContent } from '../../../content/index';
import { proto01 } from '../../../content/frontline_td/maps/proto_01';
import {
  StructuresChannel,
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  STATE_RUIN,
  type ConstructionStructures,
} from '../protocol';
import { checkFootprint, checkRange } from './index';
import { SERVICE_LAYER_ID } from '../../logistics/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../../vision/protocol';
import {
  TERRAIN_BLOCKED_LAYER_ID,
  TERRAIN_HEIGHT_LAYER_ID,
  TERRAIN_SURFACE_LAYER_ID,
} from '../../terrain/protocol';
import { makePlacementView } from './placement-view';

const db = loadContent();
const mapOrUndef = db.maps.byId(proto01.id);
if (mapOrUndef === undefined) {
  throw new Error('proto_01 missing');
}
const map = mapOrUndef;
const W = map.grid.width;
const H = map.grid.height;
const OBSERVER = 1;

function snapshotWith(overrides: {
  channels?: Snapshot['channels'];
  layers?: Snapshot['layers'];
}): Snapshot {
  return {
    tick: toTick(0),
    observer: toFactionId(OBSERVER),
    channels: overrides.channels ?? {},
    events: [],
    layers: {
      [TERRAIN_HEIGHT_LAYER_ID]: map.grid.heights,
      [TERRAIN_SURFACE_LAYER_ID]: map.grid.surfaces,
      ...overrides.layers,
    },
    changedLayers: [],
  };
}

function structures(rows: {
  kind: number[];
  x: number[];
  y: number[];
  faction: number[];
  state: number[];
}): ConstructionStructures {
  const n = rows.kind.length;
  return {
    handles: Float64Array.from({ length: n }, (_, i) => i + 1),
    kind: Uint16Array.from(rows.kind),
    x: Uint16Array.from(rows.x),
    y: Uint16Array.from(rows.y),
    faction: Uint16Array.from(rows.faction),
    state: Uint8Array.from(rows.state),
    progressBp: new Uint16Array(n),
    hpBp: new Uint16Array(n),
  };
}

const DEPOT = db.structures.byId('frontline_td:supply_depot');
const BASE = db.structures.byId('frontline_td:main_base');
const MINER = db.structures.byId('frontline_td:miner');
if (DEPOT === undefined || BASE === undefined || MINER === undefined) {
  throw new Error('structures missing');
}
const depotRule = {
  w: DEPOT.footprint.w,
  h: DEPOT.footprint.h,
  node: false,
  connect: 0,
  requiresDeposit: DEPOT.requiresDeposit ?? -1,
};

describe('makePlacementView', () => {
  it('passes a flat uncovered footprint: footprint ok, range not_covered', () => {
    const view = makePlacementView(db, map, snapshotWith({}), OBSERVER);
    expect(checkFootprint(depotRule, 20, 40, view)).toBe('ok');
    expect(checkRange(depotRule, 20, 40, view)).toBe('not_covered');
  });

  it('blocked overlay cells report occupied', () => {
    const blocked = new Uint8Array(W * H);
    blocked[40 * W + 20] = 1;
    const view = makePlacementView(
      db,
      map,
      snapshotWith({ layers: { [TERRAIN_BLOCKED_LAYER_ID]: blocked } }),
      OBSERVER,
    );
    expect(checkFootprint({ ...depotRule, w: 1, h: 1 }, 20, 40, view)).toBe('occupied');
  });

  it('own blueprints reserve their footprint', () => {
    const channel = structures({
      kind: [DEPOT.index],
      x: [20],
      y: [40],
      faction: [OBSERVER],
      state: [STATE_BLUEPRINT],
    });
    const view = makePlacementView(
      db,
      map,
      snapshotWith({ channels: { [StructuresChannel.id]: channel } }),
      OBSERVER,
    );
    expect(view.reservedByOwn(21, 41)).toBe(true);
    expect(view.reservedByOwn(19, 40)).toBe(false);
    // An enemy blueprint reserves nothing for us.
    const enemy = makePlacementView(db, map, snapshotWith({}), OBSERVER);
    expect(enemy.reservedByOwn(21, 41)).toBe(false);
  });

  it('service layer cells report covered', () => {
    const service = new Uint8Array(W * H);
    service[40 * W + 20] = 1;
    const view = makePlacementView(
      db,
      map,
      snapshotWith({ layers: { [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service } }),
      OBSERVER,
    );
    expect(view.covered(20, 40)).toBe(true);
    expect(view.covered(21, 40)).toBe(false);
    expect(checkRange({ ...depotRule, w: 1, h: 1 }, 20, 40, view)).toBe('ok');
  });

  it('ore-field cells carry the ore deposit', () => {
    const view = makePlacementView(db, map, snapshotWith({}), OBSERVER);
    const ore = db.cargos.byId('frontline_td:ore')?.index ?? -1;
    // proto_01 plateau ore field sits at x 6..8, y 46..48.
    expect(view.depositAt(7, 47)).toBe(ore);
    expect(view.depositAt(0, 0)).toBe(-1);
  });

  it('connects when a completed own node is inside the link bound', () => {
    const channel = structures({
      kind: [BASE.index],
      x: [10],
      y: [52],
      faction: [OBSERVER],
      state: [STATE_OPERATIONAL],
    });
    const view = makePlacementView(
      db,
      map,
      snapshotWith({ channels: { [StructuresChannel.id]: channel } }),
      OBSERVER,
    );
    const station = db.structures.byId('frontline_td:station');
    if (station?.node === undefined) {
      throw new Error('station has no node');
    }
    const rule = {
      w: station.footprint.w,
      h: station.footprint.h,
      node: true,
      connect: station.node.connect,
      requiresDeposit: -1,
    };
    // Right next to the base connects; far away does not.
    expect(view.connects(rule, 15, 52)).toBe(true);
    expect(view.connects(rule, 80, 10)).toBe(false);
  });
});

describe('hostile exclusion zones (M5)', () => {
  const OUTPOST = db.structures.byId('frontline_td:outpost');
  if (OUTPOST === undefined) {
    throw new Error('outpost missing');
  }
  // Hostile operational outpost at (20,40): centre (21.5,41.5), r 12.
  const channel = structures({
    kind: [OUTPOST.index],
    x: [20],
    y: [40],
    faction: [2],
    state: [STATE_OPERATIONAL],
  });
  const snap = snapshotWith({ channels: { [StructuresChannel.id]: channel } });

  it('denies range checks inside the radius, before coverage', () => {
    const view = makePlacementView(db, map, snap, OBSERVER);
    // Depot 2x2 at (19,38): centre cell (20,39) is ~2.9 from (21.5,41.5).
    expect(view.excluded(20, 39)).toBe(true);
    expect(checkRange(depotRule, 19, 38, view)).toBe('hostile_zone');
  });

  it('does not exclude outside the radius', () => {
    const view = makePlacementView(db, map, snap, OBSERVER);
    expect(view.excluded(41, 41)).toBe(false);
    expect(checkRange(depotRule, 40, 40, view)).toBe('not_covered');
  });

  it('own outposts and ruins never exclude', () => {
    const own = structures({
      kind: [OUTPOST.index, OUTPOST.index],
      x: [20, 30],
      y: [40, 40],
      faction: [OBSERVER, 2],
      state: [STATE_OPERATIONAL, STATE_RUIN],
    });
    const view = makePlacementView(
      db,
      map,
      snapshotWith({ channels: { [StructuresChannel.id]: own } }),
      OBSERVER,
    );
    expect(view.excluded(21, 41)).toBe(false);
    expect(view.excluded(31, 41)).toBe(false);
  });

  it('remembered hostile outposts in fog still exclude', () => {
    const memory: VisionMemory = {
      handles: Float64Array.from([7]),
      kind: Uint16Array.from([OUTPOST.index]),
      x: Uint16Array.from([20]),
      y: Uint16Array.from([40]),
      faction: Uint16Array.from([2]),
      state: Uint8Array.from([STATE_OPERATIONAL]),
    };
    const view = makePlacementView(
      db,
      map,
      snapshotWith({ channels: { [VisionMemoryChannel.id]: memory } }),
      OBSERVER,
    );
    expect(view.excluded(21, 41)).toBe(true);
    // A remembered ruin or own structure does not exclude.
    const dead: VisionMemory = {
      ...memory,
      faction: Uint16Array.from([2]),
      state: Uint8Array.from([STATE_RUIN]),
    };
    const clear = makePlacementView(
      db,
      map,
      snapshotWith({ channels: { [VisionMemoryChannel.id]: dead } }),
      OBSERVER,
    );
    expect(clear.excluded(21, 41)).toBe(false);
  });
});
