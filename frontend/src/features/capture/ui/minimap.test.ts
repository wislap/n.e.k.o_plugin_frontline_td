// Capture minimap mark test (ADR 0062 step 4a): re-homed from
// client/minimap-model.test.ts — contested ruin outline and
// own-leader ring joined with CapturePointsChannel.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import {
  STATE_RUIN,
  StructuresChannel,
  type ConstructionStructures,
} from '../../construction/protocol';
import { CapturePointsChannel, type CapturePoints } from '../protocol';
import { captureMinimapMarks } from './minimap';

const db = loadContent();
const OUTPOST = db.structures.byId('frontline_td:outpost');
if (OUTPOST === undefined) {
  throw new Error('required content missing');
}
const outpostIndex = OUTPOST.index;
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

function ruinStructures(handles: number[]): ConstructionStructures {
  return {
    handles: Float64Array.from(handles),
    kind: Uint16Array.from(handles.map(() => outpostIndex)),
    x: Uint16Array.from(handles.map((_h, i) => 30 + i * 4)),
    y: Uint16Array.from(handles.map(() => 30)),
    faction: Uint16Array.from(handles.map(() => 0)),
    state: Uint8Array.from(handles.map(() => STATE_RUIN)),
    progressBp: Uint16Array.from(handles.map(() => 0)),
    hpBp: Uint16Array.from(handles.map(() => 0)),
  };
}

describe('capture minimap ruin overlays', () => {
  it('emits contested outline and own-leader ring after structures', () => {
    const structures = ruinStructures([23, 24, 25]);
    const capturePoints: CapturePoints = {
      handles: Float64Array.from([23, 24, 25]),
      x: Float32Array.from([31, 35, 39]),
      y: Float32Array.from([31, 31, 31]),
      radius: Float32Array.from([4, 4, 4]),
      owner: Uint16Array.from([0, 0, 0]),
      progressBp: Uint16Array.from([4500, 4500, 4500]),
      leader: Uint16Array.from([OBSERVER, OBSERVER, ENEMY]),
      contested: Uint8Array.from([1, 0, 0]),
    };
    const snap = makeSnapshot({
      [StructuresChannel.id]: structures,
      [CapturePointsChannel.id]: capturePoints,
    });
    const marks = captureMinimapMarks[0]?.collect({
      db,
      map,
      snapshot: snap,
      isHostile,
      selected: new Set(),
      nowMs: 0,
    });
    expect(marks).toEqual([
      // Contested wins over the leader ring.
      {
        kind: 'rect',
        x: 30,
        y: 30,
        w: OUTPOST.footprint.w,
        h: OUTPOST.footprint.h,
        stroke: '#ffc14d',
        lineWidth: 1.25,
        grow: 1,
      },
      {
        kind: 'ring',
        x: 34,
        y: 30,
        w: OUTPOST.footprint.w,
        h: OUTPOST.footprint.h,
        color: '#5cc8ff',
        lineWidth: 1,
        padPx: 2,
      },
    ]);
  });
});
