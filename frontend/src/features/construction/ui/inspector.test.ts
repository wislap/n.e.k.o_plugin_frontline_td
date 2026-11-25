// Construction inspector subject tests (ADR 0062 step 3): re-homed
// from client/inspect-subject.test.ts — own/hostile structure typed
// sections, salvage and road segment resolution.
import { describe, expect, it } from 'vitest';
import {
  packHandle,
  toFactionId,
  toTick,
  type Inspection,
  type Snapshot,
} from '../../../core/index';
import { loadContent } from '../../../content/index';
import { PRODUCTION_INSPECTOR_ID } from '../../production/protocol';
import {
  CONSTRUCTION_INSPECTOR_ID,
  RoadWorksChannel,
  SalvageChannel,
  STATE_OPERATIONAL,
  STATE_SITE,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../protocol';
import {
  constructionInspectorSubjects,
  type HostileStructureView,
  type OwnStructureView,
  type RoadSegmentView,
  type SalvageView,
} from './inspector';

const db = loadContent();
const map = db.maps.list[0];
const DEPOT = db.structures.byId('frontline_td:supply_depot');
const TURRET = db.structures.byId('frontline_td:turret');
if (map === undefined || DEPOT === undefined || TURRET === undefined) {
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
  const found = constructionInspectorSubjects.find((d) => d.kind === kind);
  if (found === undefined) throw new Error(`missing def ${kind}`);
  return found;
}

describe('construction inspector subjects', () => {
  it('resolves own_structure with typed sections and hostile_structure without inspection', () => {
    const structures: ConstructionStructures = {
      handles: Float64Array.from([100, 101]),
      kind: Uint16Array.from([DEPOT.index, TURRET.index]),
      x: Uint16Array.from([10, 20]),
      y: Uint16Array.from([10, 20]),
      faction: Uint16Array.from([OBSERVER, ENEMY]),
      state: Uint8Array.from([STATE_SITE, STATE_OPERATIONAL]),
      progressBp: Uint16Array.from([4000, 10000]),
      hpBp: Uint16Array.from([10000, 8000]),
    };
    const snap = makeSnapshot({ [StructuresChannel.id]: structures });
    const insp: Inspection = {
      handle: packHandle(100, 0),
      modifiers: [],
      sections: {
        [CONSTRUCTION_INSPECTOR_ID]: {
          state: 'site',
          kind: DEPOT.id,
          x: 10,
          y: 10,
          progress: 40,
          total: 100,
          progressBp: 4000,
        },
        [PRODUCTION_INSPECTOR_ID]: {
          state: 'ready',
          progress: 0,
          total: 20,
          missing: [],
          full: [],
        },
      },
    };
    const ownStruct = def('own_structure').resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'own_structure', handle: 100 },
      selected: new Set([100]),
      inspection: insp,
    }) as OwnStructureView;
    expect(ownStruct).toMatchObject({
      kind: 'own_structure',
      handle: 100,
      contentId: DEPOT.id,
      stateName: 'site',
      progressBp: 4000,
      hasInspection: true,
      construction: { state: 'site', progressBp: 4000 },
      production: { state: 'ready', total: 20 },
    });

    const hostileStruct = def('hostile_structure').resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'hostile_structure', handle: 101 },
      selected: new Set(),
      inspection: { handle: packHandle(101, 0), modifiers: [], sections: {} },
    }) as HostileStructureView;
    expect(hostileStruct).toEqual({
      kind: 'hostile_structure',
      handle: 101,
      contentId: TURRET.id,
      faction: ENEMY,
      x: 20,
      y: 20,
      stateName: 'operational',
      progressBp: 10000,
      hpBp: 8000,
      structure: TURRET,
    });
  });

  it('resolves salvage and road segments', () => {
    const salvage: ConstructionSalvage = {
      handles: Float64Array.from([400]),
      x: Float32Array.from([12.5]),
      y: Float32Array.from([14.5]),
    };
    const roadWorks: RoadWorks = {
      segments: {
        handles: Float64Array.from([500]),
        x: Float32Array.from([22.5]),
        y: Float32Array.from([24.5]),
        progressBp: Uint16Array.from([7500]),
        hpBp: Uint16Array.from([9000]),
      },
      projects: {
        offsets: Uint32Array.from([0]),
        cells: Uint32Array.from([]),
        built: Uint16Array.from([]),
        level: Uint8Array.from([]),
      },
    };
    const snap = makeSnapshot({
      [SalvageChannel.id]: salvage,
      [RoadWorksChannel.id]: roadWorks,
    });

    expect(
      def('salvage').resolve({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: { kind: 'salvage', handle: 400 },
        selected: new Set(),
        inspection: null,
      }) as SalvageView,
    ).toEqual({
      kind: 'salvage',
      handle: 400,
      x: 12.5,
      y: 14.5,
      construction: null,
      logistics: null,
      hasInspection: false,
    });

    expect(
      def('road_segment').resolve({
        db,
        map,
        snapshot: snap,
        isHostile,
        subject: { kind: 'road_segment', handle: 500 },
        selected: new Set(),
        inspection: null,
      }) as RoadSegmentView,
    ).toEqual({
      kind: 'road_segment',
      handle: 500,
      x: 22.5,
      y: 24.5,
      progressBp: 7500,
      hpBp: 9000,
      construction: null,
      logistics: null,
      combat: null,
      hasInspection: false,
    });
  });
});
