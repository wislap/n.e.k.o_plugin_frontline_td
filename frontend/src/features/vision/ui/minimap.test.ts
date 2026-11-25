// Vision minimap mark test (ADR 0062 step 4a): re-homed from
// client/minimap-model.test.ts — fog-memory ghosts with
// disposition colours and 0.65 alpha.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { STATE_OPERATIONAL, STATE_RUIN } from '../../construction/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../protocol';
import { visionMinimapMarks } from './minimap';

const db = loadContent();
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const OUTPOST = db.structures.byId('frontline_td:outpost');
const TURRET = db.structures.byId('frontline_td:turret');
if (DEPOT === undefined || OUTPOST === undefined || TURRET === undefined) {
  throw new Error('required content missing');
}
const map = db.maps.list[0];
if (map === undefined) {
  throw new Error('required content missing');
}

const OBSERVER = 1;
const ENEMY = 2;
const ALLY = 3;
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

describe('vision minimap memories', () => {
  it('emits alpha-dimmed rects coloured by memory disposition', () => {
    const memory: VisionMemory = {
      handles: Float64Array.from([10, 11, 12]),
      kind: Uint16Array.from([DEPOT.index, OUTPOST.index, TURRET.index]),
      x: Uint16Array.from([4, 8, 12]),
      y: Uint16Array.from([5, 9, 13]),
      faction: Uint16Array.from([ENEMY, 0, ALLY]),
      state: Uint8Array.from([STATE_OPERATIONAL, STATE_RUIN, STATE_OPERATIONAL]),
    };
    const snap = makeSnapshot({ [VisionMemoryChannel.id]: memory });
    const marks = visionMinimapMarks[0]?.collect({
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
        x: 4,
        y: 5,
        w: DEPOT.footprint.w,
        h: DEPOT.footprint.h,
        fill: '#8a5058',
        alpha: 0.65,
      },
      {
        kind: 'rect',
        x: 8,
        y: 9,
        w: OUTPOST.footprint.w,
        h: OUTPOST.footprint.h,
        fill: '#5b7390',
        alpha: 0.65,
      },
      {
        kind: 'rect',
        x: 12,
        y: 13,
        w: TURRET.footprint.w,
        h: TURRET.footprint.h,
        fill: '#468a73',
        alpha: 0.65,
      },
    ]);
  });
});
