// Units inspector subject tests (ADR 0062 step 3): re-homed from
// client/inspect-subject.test.ts — multi-selection breakdown and
// own/hostile unit resolution with typed inspection sections.
import { describe, expect, it } from 'vitest';
import {
  packHandle,
  toFactionId,
  toTick,
  type Inspection,
  type Snapshot,
} from '../../../core/index';
import { loadContent } from '../../../content/index';
import { COMBAT_INSPECTOR_ID } from '../../combat/protocol';
import {
  STATE_OPERATIONAL,
  StructuresChannel,
  type ConstructionStructures,
} from '../../construction/protocol';
import { LOGISTICS_INSPECTOR_ID } from '../../logistics/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../protocol';
import {
  unitsInspectorSubjects,
  type HostileUnitView,
  type MultiOwnView,
  type OwnUnitView,
} from './inspector';

const db = loadContent();
const map = db.maps.list[0];
const ROBOT = db.units.byId('frontline_td:robot');
const RAIDER = db.units.byId('frontline_td:raider');
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const TURRET = db.structures.byId('frontline_td:turret');
if (
  map === undefined ||
  ROBOT === undefined ||
  RAIDER === undefined ||
  DEPOT === undefined ||
  TURRET === undefined
) {
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

function def(kind: string) {
  const found = unitsInspectorSubjects.find((d) => d.kind === kind);
  if (found === undefined) throw new Error(`missing def ${kind}`);
  return found;
}

describe('units inspector subjects', () => {
  it('computes sorted per-kind breakdown for multi_own', () => {
    const units: DenseUnits = {
      handles: Float64Array.from([1, 2, 3]),
      x: Float32Array.from([5, 6, 7]),
      y: Float32Array.from([5, 6, 7]),
      kind: Uint16Array.from([ROBOT.index, ROBOT.index, RAIDER.index]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, OBSERVER]),
      moving: Uint8Array.from([0, 1, 0]),
      hpBp: Uint16Array.from([10000, 10000, 10000]),
      energyBp: Uint16Array.from([10000, 8000, 0xffff]),
    };
    const structures: ConstructionStructures = {
      handles: Float64Array.from([10, 11, 12]),
      kind: Uint16Array.from([DEPOT.index, DEPOT.index, TURRET.index]),
      x: Uint16Array.from([1, 4, 8]),
      y: Uint16Array.from([1, 4, 8]),
      faction: Uint16Array.from([OBSERVER, OBSERVER, OBSERVER]),
      state: Uint8Array.from([STATE_OPERATIONAL, STATE_OPERATIONAL, STATE_OPERATIONAL]),
      progressBp: Uint16Array.from([10000, 10000, 10000]),
      hpBp: Uint16Array.from([10000, 10000, 10000]),
    };
    const view = def('multi_own').resolve({
      db,
      map,
      snapshot: makeSnapshot({
        [DenseUnitsChannel.id]: units,
        [StructuresChannel.id]: structures,
      }),
      isHostile,
      subject: { kind: 'multi_own', count: 5 },
      selected: new Set([1, 2, 3, 10, 11]),
      inspection: null,
    }) as MultiOwnView;
    expect(view).toEqual({
      kind: 'multi_own',
      count: 5,
      breakdown: [
        { category: 'structure', contentId: DEPOT.id, count: 2 },
        { category: 'unit', contentId: ROBOT.id, count: 2 },
        { category: 'unit', contentId: RAIDER.id, count: 1 },
      ],
    });
  });

  it('attaches inspection sections only for matching own_unit and never for hostile_unit', () => {
    const units: DenseUnits = {
      handles: Float64Array.from([1, 2]),
      x: Float32Array.from([5, 6]),
      y: Float32Array.from([5, 6]),
      kind: Uint16Array.from([ROBOT.index, RAIDER.index]),
      faction: Uint16Array.from([OBSERVER, ENEMY]),
      moving: Uint8Array.from([1, 0]),
      hpBp: Uint16Array.from([7500, 9000]),
      energyBp: Uint16Array.from([5000, 0xffff]),
    };
    const snap = makeSnapshot({ [DenseUnitsChannel.id]: units });
    const ownInspection: Inspection = {
      handle: packHandle(1, 0),
      modifiers: [{ stat: 'speed', source: 'energy_low', op: 'mul_bp', value: 5000 }],
      sections: {
        [COMBAT_INSPECTOR_ID]: { hp: 75000, max: 100000, readyIn: 0 },
        [LOGISTICS_INSPECTOR_ID]: {
          slots: [],
          bottleneck: 0,
          attachedNode: null,
          node: null,
        },
      },
    };
    // The shell hands resolvers the inspection already matched to the
    // subject handle; matchInspection() covers the stale-handle case.
    const ownView = def('own_unit').resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'own_unit', handle: 1 },
      selected: new Set([1]),
      inspection: ownInspection,
    }) as OwnUnitView;
    expect(ownView).toMatchObject({
      kind: 'own_unit',
      handle: 1,
      contentId: ROBOT.id,
      moving: true,
      hpBp: 7500,
      energyBp: 5000,
      hasInspection: true,
      combat: { hp: 75000, max: 100000, readyIn: 0 },
      modifiers: [{ stat: 'speed', source: 'energy_low', op: 'mul_bp', value: 5000 }],
    });

    const noInspectionView = def('own_unit').resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'own_unit', handle: 1 },
      selected: new Set([1]),
      inspection: null,
    }) as OwnUnitView;
    expect(noInspectionView).toMatchObject({
      kind: 'own_unit',
      handle: 1,
      hasInspection: false,
      combat: null,
      logistics: null,
      modifiers: [],
    });

    // Even with a matched inspection object handed in, hostile_unit
    // never exposes it.
    const hostileInspection: Inspection = {
      handle: packHandle(2, 0),
      modifiers: [{ stat: 'speed', source: 'secret', op: 'mul_bp', value: 1 }],
      sections: { [COMBAT_INSPECTOR_ID]: { hp: 90, max: 100 } },
    };
    const hostileView = def('hostile_unit').resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'hostile_unit', handle: 2 },
      selected: new Set(),
      inspection: hostileInspection,
    }) as HostileUnitView;
    expect(hostileView).toEqual({
      kind: 'hostile_unit',
      handle: 2,
      contentId: RAIDER.id,
      faction: ENEMY,
      moving: false,
      hpBp: 9000,
      energyBp: null,
      unit: RAIDER,
    });
    expect('combat' in hostileView).toBe(false);
    expect('modifiers' in hostileView).toBe(false);
  });
});
