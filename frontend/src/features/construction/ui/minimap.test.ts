// Construction minimap mark test (ADR 0062 step 4a): re-homed from
// client/minimap-model.test.ts — blueprint outline, faction fill and
// own-core outline for structures.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import {
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionStructures,
} from '../protocol';
import { constructionMinimapMarks } from './minimap';

const db = loadContent();
const MAIN_BASE = db.structures.byId('frontline_td:main_base');
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const OUTPOST = db.structures.byId('frontline_td:outpost');
const TURRET = db.structures.byId('frontline_td:turret');
if (
  MAIN_BASE === undefined ||
  DEPOT === undefined ||
  OUTPOST === undefined ||
  TURRET === undefined
) {
  throw new Error('required content missing');
}
const map = db.maps.list[0];
if (map === undefined) {
  throw new Error('required content missing');
}

const OBSERVER = 1;
const ENEMY = 2;
const isHostile = (observer: number, faction: number): boolean =>
  faction === ENEMY && faction !== observer;

function makeSnapshot(channels: Snapshot['channels'] = {}): Snapshot {
  return {
    tick: toTick(10),
    observer: toFactionId(OBSERVER),
    channels,
    events: [],
    layers: {},
    changedLayers: [],
  };
}

describe('construction minimap structures', () => {
  it('emits blueprint stroke, faction fill and own-core outline marks', () => {
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
    const snap = makeSnapshot({ [StructuresChannel.id]: structures });
    const marks = constructionMinimapMarks[0]?.collect({
      db,
      map,
      snapshot: snap,
      isHostile,
      selected: new Set(),
      nowMs: 0,
    });
    expect(marks).toEqual([
      {
        kind: 'rect',
        x: 2,
        y: 2,
        w: MAIN_BASE.footprint.w,
        h: MAIN_BASE.footprint.h,
        fill: '#9be2ff',
      },
      {
        kind: 'rect',
        x: 2,
        y: 2,
        w: MAIN_BASE.footprint.w,
        h: MAIN_BASE.footprint.h,
        stroke: '#eef8ff',
        lineWidth: 1,
        grow: 0.5,
      },
      {
        kind: 'rect',
        x: 6,
        y: 6,
        w: DEPOT.footprint.w,
        h: DEPOT.footprint.h,
        stroke: '#5cc8ff',
        lineWidth: 1,
        grow: -0.5,
      },
      {
        kind: 'rect',
        x: 20,
        y: 20,
        w: TURRET.footprint.w,
        h: TURRET.footprint.h,
        fill: '#ff5c5c',
      },
      {
        kind: 'rect',
        x: 30,
        y: 30,
        w: OUTPOST.footprint.w,
        h: OUTPOST.footprint.h,
        fill: '#c8a24a',
      },
    ]);
  });
});
