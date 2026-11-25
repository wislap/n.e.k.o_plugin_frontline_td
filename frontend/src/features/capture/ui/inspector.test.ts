// Capture inspector subject test (ADR 0062 step 3): re-homed from
// client/inspect-subject.test.ts — ruin view joined with
// CapturePointsChannel.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { loadContent } from '../../../content/index';
import {
  STATE_RUIN,
  StructuresChannel,
  type ConstructionStructures,
} from '../../construction/protocol';
import { CapturePointsChannel, type CapturePoints } from '../protocol';
import { captureInspectorSubjects, type RuinView } from './inspector';

const db = loadContent();
const map = db.maps.list[0];
const OUTPOST = db.structures.byId('frontline_td:outpost');
if (map === undefined || OUTPOST === undefined) {
  throw new Error('required content missing');
}

const OBSERVER = 1;
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

describe('capture inspector subject', () => {
  it('resolves ruins joined with CapturePointsChannel', () => {
    const structures: ConstructionStructures = {
      handles: Float64Array.from([300]),
      kind: Uint16Array.from([OUTPOST.index]),
      x: Uint16Array.from([30]),
      y: Uint16Array.from([30]),
      faction: Uint16Array.from([0]),
      state: Uint8Array.from([STATE_RUIN]),
      progressBp: Uint16Array.from([0]),
      hpBp: Uint16Array.from([0]),
    };
    const capturePoints: CapturePoints = {
      handles: Float64Array.from([300]),
      x: Float32Array.from([31]),
      y: Float32Array.from([31]),
      radius: Float32Array.from([4]),
      owner: Uint16Array.from([OBSERVER]),
      progressBp: Uint16Array.from([6500]),
      leader: Uint16Array.from([OBSERVER]),
      contested: Uint8Array.from([1]),
    };
    const snap = makeSnapshot({
      [StructuresChannel.id]: structures,
      [CapturePointsChannel.id]: capturePoints,
    });

    const ruin = captureInspectorSubjects.find((d) => d.kind === 'ruin');
    if (ruin === undefined) throw new Error('missing ruin def');
    expect(
      ruin.resolve({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: { kind: 'ruin', handle: 300 },
        selected: new Set(),
        inspection: null,
      }) as RuinView,
    ).toEqual({
      kind: 'ruin',
      handle: 300,
      contentId: OUTPOST.id,
      x: 30,
      y: 30,
      structure: OUTPOST,
      progressBp: 6500,
      leader: OBSERVER,
      owner: OBSERVER,
      contested: true,
    });
  });
});
