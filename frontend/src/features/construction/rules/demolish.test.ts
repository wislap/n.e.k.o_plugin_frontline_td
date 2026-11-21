import { describe, expect, it } from 'vitest';
import { loadContent, type ResolvedStructure } from '../../../content/index';
import {
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_OPERATIONAL,
  STATE_RUIN,
  STATE_SITE,
  STATE_WAITING,
  type ConstructionStructures,
  type RoadWorks,
} from '../protocol';
import { centeredFootprint, classifyCancelSelection, demolishRefund } from './demolish';

function must<T>(v: T | undefined, name: string): T {
  if (v === undefined) {
    throw new Error(`base pack entry '${name}' missing`);
  }
  return v;
}

const DB = loadContent();
const STATION = must(DB.structures.byId('frontline_td:station'), 'station');
const DEPOT = must(DB.structures.byId('frontline_td:supply_depot'), 'supply_depot');
const MAIN_BASE = must(DB.structures.byId('frontline_td:main_base'), 'main_base');
const OUTPOST = must(DB.structures.byId('frontline_td:outpost'), 'outpost');
const MATERIAL = must(DB.cargos.byId('frontline_td:material'), 'material').index;

function makeStructures(
  rows: { handle: number; kind: number; faction: number; state: number }[],
): ConstructionStructures {
  const n = rows.length;
  const out: ConstructionStructures = {
    handles: new Float64Array(n),
    kind: new Uint16Array(n),
    x: new Uint16Array(n),
    y: new Uint16Array(n),
    faction: new Uint16Array(n),
    state: new Uint8Array(n),
    progressBp: new Uint16Array(n),
    hpBp: new Uint16Array(n),
  };
  rows.forEach((r, i) => {
    out.handles[i] = r.handle;
    out.kind[i] = r.kind;
    out.faction[i] = r.faction;
    out.state[i] = r.state;
  });
  return out;
}

function makeRoadWorks(segmentHandles: number[]): RoadWorks {
  const n = segmentHandles.length;
  return {
    segments: {
      handles: new Float64Array(segmentHandles),
      x: new Float32Array(n),
      y: new Float32Array(n),
      progressBp: new Uint16Array(n),
      hpBp: new Uint16Array(n),
    },
    projects: {
      offsets: new Uint32Array([0]),
      cells: new Uint32Array(0),
      built: new Uint16Array(0),
      level: new Uint8Array(0),
    },
  };
}

describe('centeredFootprint', () => {
  it('centers even and odd footprints around the ground point', () => {
    expect(centeredFootprint(10.8, 20.2, { w: 2, h: 2 })).toEqual({ x: 9, y: 19 });
    expect(centeredFootprint(10.8, 20.2, { w: 3, h: 3 })).toEqual({ x: 9, y: 18 });
    expect(centeredFootprint(5.5, 5.5, { w: 1, h: 1 })).toEqual({ x: 5, y: 5 });
  });

  it('floors negative results toward -Infinity', () => {
    expect(centeredFootprint(0.5, 1.0, { w: 4, h: 4 })).toEqual({ x: -2, y: -1 });
  });
});

describe('demolishRefund', () => {
  it('computes floor(cost * salvageBp / 10000) and drops zero entries', () => {
    expect(demolishRefund(STATION)).toEqual([{ cargo: MATERIAL, milli: 10000 }]);
    expect(demolishRefund(MAIN_BASE)).toEqual([]);

    const custom: ResolvedStructure = {
      ...STATION,
      build: {
        cost: [
          { cargo: 2, milli: 3 },
          { cargo: 0, milli: 1 },
        ],
        timeTicks: 10,
        demolishTicks: 10,
        salvageBp: 5000,
      },
    };
    // floorDiv(3 * 5000, 10000) = 1; floorDiv(1 * 5000, 10000) = 0 (filtered)
    expect(demolishRefund(custom)).toEqual([{ cargo: 2, milli: 1 }]);
  });
});

describe('classifyCancelSelection', () => {
  it('classifies blueprints, waiting, sites, buildable operational, and road segments', () => {
    const structures = makeStructures([
      { handle: 101, kind: STATION.index, faction: 1, state: STATE_BLUEPRINT },
      { handle: 102, kind: STATION.index, faction: 1, state: STATE_WAITING },
      { handle: 103, kind: STATION.index, faction: 1, state: STATE_SITE },
      { handle: 104, kind: STATION.index, faction: 1, state: STATE_OPERATIONAL },
      { handle: 105, kind: DEPOT.index, faction: 1, state: STATE_OPERATIONAL },
      { handle: 106, kind: MAIN_BASE.index, faction: 1, state: STATE_OPERATIONAL },
      { handle: 107, kind: OUTPOST.index, faction: 1, state: STATE_SITE },
      { handle: 108, kind: STATION.index, faction: 1, state: STATE_DEMOLISHING },
      { handle: 109, kind: OUTPOST.index, faction: 0, state: STATE_RUIN },
      { handle: 110, kind: STATION.index, faction: 2, state: STATE_OPERATIONAL },
      { handle: 111, kind: STATION.index, faction: 2, state: STATE_BLUEPRINT },
    ]);
    const roadWorks = makeRoadWorks([201]);

    const result = classifyCancelSelection(
      DB,
      structures,
      roadWorks,
      1,
      [101, 102, 103, 104, 104, 105, 106, 107, 108, 109, 110, 111, 201, 201, 999],
    );

    expect(result.cancellable).toEqual([101, 102, 103, 104, 105, 201]);
    expect(result.operational).toEqual([104, 105]);
    // station (10000) + supply_depot (15000) = 25000 milli material
    expect(result.refunds).toEqual([{ cargo: MATERIAL, milli: 25000 }]);
  });

  it('sorts accumulated refunds by cargo index ascending across multiple cargos', () => {
    const multiKind: ResolvedStructure = {
      ...STATION,
      index: 99,
      build: {
        cost: [
          { cargo: 3, milli: 4000 },
          { cargo: 1, milli: 2000 },
        ],
        timeTicks: 10,
        demolishTicks: 10,
        salvageBp: 5000,
      },
    };
    const fakeDb = {
      ...DB,
      structures: {
        ...DB.structures,
        byIndex: (idx: number) => (idx === 99 ? multiKind : DB.structures.byIndex(idx)),
      },
    };
    const structures = makeStructures([
      { handle: 10, kind: 99, faction: 1, state: STATE_OPERATIONAL },
      { handle: 11, kind: 99, faction: 1, state: STATE_OPERATIONAL },
    ]);

    const result = classifyCancelSelection(fakeDb, structures, null, 1, [10, 11]);
    expect(result.cancellable).toEqual([10, 11]);
    expect(result.operational).toEqual([10, 11]);
    expect(result.refunds).toEqual([
      { cargo: 1, milli: 2000 },
      { cargo: 3, milli: 4000 },
    ]);
  });

  it('handles null channels cleanly', () => {
    expect(classifyCancelSelection(DB, null, null, 1, [1, 2, 3])).toEqual({
      cancellable: [],
      operational: [],
      refunds: [],
    });
  });
});
