// Terrain inspector subject tests (ADR 0062 step 3): re-homed from
// client/inspect-subject.test.ts — strict fog hiding on unexplored
// cells and surface/deposit/coverage/exclusion on explored cells.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { loadContent } from '../../../content/index';
import {
  STATE_OPERATIONAL,
  StructuresChannel,
  type ConstructionStructures,
} from '../../construction/protocol';
import { ROAD_LAYER_ID, SERVICE_LAYER_ID } from '../../logistics/protocol';
import { VISION_STATE_LAYER_ID } from '../../vision/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';
import { terrainInspectorSubjects, type CellView } from './inspector';

const db = loadContent();
const map = db.maps.list[0];
const OUTPOST = db.structures.byId('frontline_td:outpost');
const ORE_SURFACE = db.surfaces.list.find((s) => s.deposit !== undefined);
if (map === undefined || OUTPOST === undefined || ORE_SURFACE === undefined) {
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

function cellDef() {
  const found = terrainInspectorSubjects.find((d) => d.kind === 'cell');
  if (found === undefined) throw new Error('missing cell def');
  return found;
}

describe('terrain inspector subject', () => {
  it('hides all terrain, deposit, road, and coverage details on unexplored fog cells', () => {
    const size = map.width * map.height;
    const fog = new Uint8Array(size); // 0 = unexplored everywhere
    const surfaces = new Uint16Array(size).fill(ORE_SURFACE.index);
    const heights = new Uint8Array(size).fill(7);
    const roads = new Uint8Array(size).fill(2);
    const service = new Uint8Array(size).fill(1);
    const snap = makeSnapshot(
      {},
      {
        [`${VISION_STATE_LAYER_ID}#${OBSERVER}`]: fog,
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
        [ROAD_LAYER_ID]: roads,
        [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service,
      },
    );
    const view = cellDef().resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'cell', x: 4, y: 5 },
      selected: new Set(),
      inspection: null,
    }) as CellView;
    expect(view).toEqual({ kind: 'cell_unexplored', x: 4, y: 5 });
  });

  it('reads surface, deposit, height, ramp, road, coverage, and hostile exclusion on explored cells', () => {
    const size = map.width * map.height;
    const fog = new Uint8Array(size).fill(1);
    const cellX = 10;
    const cellY = 10;
    const idx = cellY * map.width + cellX;
    fog[idx] = 2;
    const surfaces = new Uint16Array(size).fill(ORE_SURFACE.index);
    const heights = new Uint8Array(size).fill(3);
    const roads = new Uint8Array(size);
    roads[idx] = 1;
    const service = new Uint8Array(size);
    service[idx] = 1;
    const hostileOutpost: ConstructionStructures = {
      handles: Float64Array.from([500]),
      kind: Uint16Array.from([OUTPOST.index]),
      x: Uint16Array.from([12]),
      y: Uint16Array.from([10]),
      faction: Uint16Array.from([ENEMY]),
      state: Uint8Array.from([STATE_OPERATIONAL]),
      progressBp: Uint16Array.from([10000]),
      hpBp: Uint16Array.from([10000]),
    };
    const snap = makeSnapshot(
      { [StructuresChannel.id]: hostileOutpost },
      {
        [`${VISION_STATE_LAYER_ID}#${OBSERVER}`]: fog,
        [TERRAIN_SURFACE_LAYER_ID]: surfaces,
        [TERRAIN_HEIGHT_LAYER_ID]: heights,
        [ROAD_LAYER_ID]: roads,
        [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service,
      },
    );
    const view = cellDef().resolve({
      db,
      map,
      snapshot: snap,
      isHostile,
      subject: { kind: 'cell', x: cellX, y: cellY },
      selected: new Set(),
      inspection: null,
    }) as CellView;
    const depositCargoId =
      ORE_SURFACE.deposit !== undefined
        ? (db.cargos.byIndex(ORE_SURFACE.deposit)?.id ?? null)
        : null;
    expect(view).toEqual({
      kind: 'cell',
      x: cellX,
      y: cellY,
      visionState: 2,
      surfaceId: ORE_SURFACE.id,
      depositId: depositCargoId,
      height: 3,
      isRamp: (map.grid.ramps[idx] ?? 0) !== 0,
      roadLevel: 1,
      covered: true,
      excluded: true,
    });
  });
});
