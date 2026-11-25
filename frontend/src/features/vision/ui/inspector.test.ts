// Vision inspector subject test (ADR 0062 step 3): re-homed from
// client/inspect-subject.test.ts — fog-of-war memory ghost resolution.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { loadContent } from '../../../content/index';
import { STATE_OPERATIONAL } from '../../construction/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../protocol';
import { visionInspectorSubjects, type MemoryView } from './inspector';

const db = loadContent();
const map = db.maps.list[0];
const DEPOT = db.structures.byId('frontline_td:supply_depot');
if (map === undefined || DEPOT === undefined) {
  throw new Error('required content missing');
}

const OBSERVER = 1;
const ENEMY = 2;
const isHostile = (observer: number, faction: number): boolean =>
  faction !== 0 && faction !== observer;

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

describe('vision inspector subject', () => {
  it('resolves vision memory ghosts', () => {
    const memory: VisionMemory = {
      handles: Float64Array.from([600]),
      kind: Uint16Array.from([DEPOT.index]),
      x: Uint16Array.from([44]),
      y: Uint16Array.from([45]),
      faction: Uint16Array.from([ENEMY]),
      state: Uint8Array.from([STATE_OPERATIONAL]),
    };
    const snap = makeSnapshot({ [VisionMemoryChannel.id]: memory });

    const def = visionInspectorSubjects.find((d) => d.kind === 'memory');
    if (def === undefined) throw new Error('missing memory def');
    expect(
      def.resolve({
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
      }) as MemoryView,
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
