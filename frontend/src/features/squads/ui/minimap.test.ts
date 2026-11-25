// Squads minimap mark test (ADR 0062 step 4a): re-homed from
// client/minimap-model.test.ts — hostile threat routes and pulsing
// gather diamonds; allied and guard squads filtered out.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { SquadsChannel, type SquadsSnapshot } from '../protocol';
import { squadsMinimapMarks } from './minimap';

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

describe('squads minimap threats', () => {
  it('emits dashed route then pulsing diamond for hostile gather/advance only', () => {
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
    const snap = makeSnapshot({ [SquadsChannel.id]: squads });
    // nowMs = 0 → pulse = 0.5 → radiusPx 4, '#ffc14d'.
    const marks = squadsMinimapMarks[0]?.collect({
      db,
      map,
      snapshot: snap,
      isHostile,
      selected: new Set(),
      nowMs: 0,
    });
    expect(marks).toEqual([
      {
        kind: 'path',
        points: [25.5, 26.5, 14.5, 14.5, 4.5, 4.5],
        color: '#ff5c5c',
        lineWidth: 1.25,
        dash: [4, 3],
      },
      {
        kind: 'diamond',
        x: 25,
        y: 26,
        radiusPx: 4,
        color: '#ffc14d',
        lineWidth: 1.5,
      },
    ]);
  });
});
