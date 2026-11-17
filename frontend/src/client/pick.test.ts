// Selection priority (M3 D): own unit under the cursor wins over a
// structure; structures/blueprints/salvage only when no unit is near.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../core/index';
import { loadContent } from '../content/index';
import {
  SalvageChannel,
  StructuresChannel,
  STATE_OPERATIONAL,
  type ConstructionSalvage,
  type ConstructionStructures,
} from '../features/construction/protocol';
import { pickAt } from './pick';

const db = loadContent();
const DEPOT = db.structures.byId('frontline_td:supply_depot');
if (DEPOT === undefined) {
  throw new Error('depot missing');
}
const OBSERVER = 1;

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

const structures: ConstructionStructures = {
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
      snapshot({ [StructuresChannel.id]: structures }),
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
      snapshot({ [StructuresChannel.id]: structures }),
      OBSERVER,
      units,
      11,
      11,
    );
    expect(pick).toBe(100);
  });

  it('ignores enemy units and enemy structures', () => {
    const enemy: ConstructionStructures = {
      ...structures,
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
