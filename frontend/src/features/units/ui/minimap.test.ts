// Units minimap mark test (ADR 0062 step 4a): re-homed from
// client/minimap-model.test.ts — unselected dots first, selected own
// units on top with halo + core.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { DenseUnitsChannel, type DenseUnits } from '../protocol';
import { MINIMAP_PALETTE } from '../../../ui/minimap/palette';
import { unitsMinimapMarks } from './minimap';

const db = loadContent();
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

describe('units minimap dots', () => {
  it('emits unselected dots first, then halo+core for selected own units', () => {
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
    const snap = makeSnapshot({ [DenseUnitsChannel.id]: units });
    // Enemy handle 102 in the selected set must not mark selected.
    const marks = unitsMinimapMarks[0]?.collect({
      db,
      map,
      snapshot: snap,
      isHostile,
      selected: new Set([100, 102]),
      nowMs: 0,
    });
    expect(MINIMAP_PALETTE.hostile).toBe('#ff5c5c');
    expect(marks).toEqual([
      { kind: 'dot', x: 4.5, y: 4.5, sizePx: 2.5, color: MINIMAP_PALETTE.ownUnit },
      { kind: 'dot', x: 18.5, y: 18.5, sizePx: 2.5, color: MINIMAP_PALETTE.hostile },
      { kind: 'dot', x: 19.5, y: 19.5, sizePx: 2.5, color: MINIMAP_PALETTE.ally },
      { kind: 'dot', x: 3.5, y: 3.5, sizePx: 5, color: MINIMAP_PALETTE.ownUnit },
      { kind: 'dot', x: 3.5, y: 3.5, sizePx: 3, color: MINIMAP_PALETTE.selectedCore },
    ]);
  });
});
