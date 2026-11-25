import { describe, expect, it } from 'vitest';
import { makeIsHostile } from '../../../client/hostility';
import { loadContent } from '../../../content/index';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  STATE_OPERATIONAL,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../../construction/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../../units/protocol';
import {
  VISION_STATE_LAYER_ID,
  VisionMemoryChannel,
  type VisionMemory,
} from '../../vision/protocol';
import { collectSelectionHighlights, type SelectionHighlightInput } from './selection-highlights';

const db = loadContent();
const isHostile = makeIsHostile([{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }]);

function idxOfStructure(id: string): number {
  const s = db.structures.byId(id);
  if (s === undefined) {
    throw new Error(`missing structure ${id}`);
  }
  return s.index;
}

function idxOfUnit(id: string): number {
  const u = db.units.byId(id);
  if (u === undefined) {
    throw new Error(`missing unit ${id}`);
  }
  return u.index;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: toTick(1),
    observer: toFactionId(1),
    channels: {},
    events: [],
    layers: {},
    changedLayers: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<SelectionHighlightInput> = {}): SelectionHighlightInput {
  return {
    db,
    mapWidth: 16,
    mapHeight: 16,
    snapshot: makeSnapshot(),
    units: new Map(),
    selected: new Set(),
    hovered: null,
    pinned: null,
    toolKind: 'none',
    demolishHoverHandle: null,
    demolishConfirmTargets: [],
    isHostile,
    ...overrides,
  };
}

function makeStructures(
  rows: { handle: number; id: string; x: number; y: number; faction: number; state?: number }[],
): ConstructionStructures {
  return {
    handles: new Float64Array(rows.map((r) => r.handle)),
    kind: new Uint16Array(rows.map((r) => idxOfStructure(r.id))),
    x: new Uint16Array(rows.map((r) => r.x)),
    y: new Uint16Array(rows.map((r) => r.y)),
    faction: new Uint16Array(rows.map((r) => r.faction)),
    state: new Uint8Array(rows.map((r) => r.state ?? STATE_OPERATIONAL)),
    progressBp: new Uint16Array(rows.map(() => 10000)),
    hpBp: new Uint16Array(rows.map(() => 10000)),
  };
}

describe('collectSelectionHighlights', () => {
  it('suppresses unexplored fog cells and emits cell_hover only for explored/visible cells', () => {
    const fog = new Uint8Array(16 * 16);
    fog[2 * 16 + 3] = 0; // unexplored
    fog[2 * 16 + 4] = 1; // explored
    fog[2 * 16 + 5] = 2; // visible
    const snap = makeSnapshot({
      layers: { [`${VISION_STATE_LAYER_ID}#1`]: fog },
    });

    const unexplored = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'cell', x: 3, y: 2 } }),
    );
    expect(unexplored.brackets).toEqual([]);

    const explored = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'cell', x: 4, y: 2 } }),
    );
    expect(explored.brackets).toEqual([{ x: 4, y: 2, w: 1, h: 1, tone: 'cell_hover' }]);

    const visible = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'cell', x: 5, y: 2 } }),
    );
    expect(visible.brackets).toEqual([{ x: 5, y: 2, w: 1, h: 1, tone: 'cell_hover' }]);

    const withPlaceTool = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'cell', x: 5, y: 2 }, toolKind: 'place' }),
    );
    expect(withPlaceTool.brackets).toEqual([]);

    const noSnap = collectSelectionHighlights(
      baseInput({ snapshot: null, hovered: { kind: 'cell', x: 5, y: 2 } }),
    );
    expect(noSnap.brackets).toEqual([]);
  });

  it('highlights demolishHover and demolishConfirm targets with danger and overrides selected', () => {
    const structures = makeStructures([
      { handle: 10, id: 'frontline_td:turret', x: 3, y: 4, faction: 1 },
      { handle: 11, id: 'frontline_td:station', x: 6, y: 6, faction: 1 },
    ]);
    const roadWorks: RoadWorks = {
      segments: {
        handles: new Float64Array([20]),
        x: new Float32Array([9.5]),
        y: new Float32Array([8.5]),
        progressBp: new Uint16Array([5000]),
        hpBp: new Uint16Array([10000]),
      },
      projects: {
        offsets: new Uint32Array([0]),
        cells: new Uint32Array([]),
        built: new Uint16Array([]),
        level: new Uint8Array([]),
      },
    };
    const snap = makeSnapshot({
      channels: {
        [StructuresChannel.id]: structures,
        [RoadWorksChannel.id]: roadWorks,
      },
    });

    const res = collectSelectionHighlights(
      baseInput({
        snapshot: snap,
        selected: new Set([10, 11, 20]),
        toolKind: 'demolish',
        demolishHoverHandle: 20,
        demolishConfirmTargets: [10],
      }),
    );

    expect(res.brackets).toContainEqual({ x: 3, y: 4, w: 1, h: 1, tone: 'danger' });
    expect(res.brackets).toContainEqual({
      x: 9.5 - 0.45,
      y: 8.5 - 0.45,
      w: 0.9,
      h: 0.9,
      tone: 'danger',
    });
    expect(res.brackets).toContainEqual({ x: 6, y: 6, w: 2, h: 2, tone: 'selected' });
    // Danger handles must not also emit selected brackets.
    expect(res.brackets.filter((b) => b.tone === 'selected')).toHaveLength(1);

    // demolishHoverHandle is ignored when toolKind !== 'demolish'.
    const outsideDemolish = collectSelectionHighlights(
      baseInput({
        snapshot: snap,
        toolKind: 'none',
        demolishHoverHandle: 20,
        demolishConfirmTargets: [10],
      }),
    );
    expect(outsideDemolish.brackets).toEqual([{ x: 3, y: 4, w: 1, h: 1, tone: 'danger' }]);
  });

  it('resolves pinned brackets for own, hostile, ruin, memory, salvage, road_segment, and units', () => {
    const structures = makeStructures([
      { handle: 1, id: 'frontline_td:station', x: 2, y: 2, faction: 1 },
      { handle: 2, id: 'frontline_td:turret', x: 8, y: 3, faction: 2 },
      { handle: 3, id: 'frontline_td:outpost', x: 10, y: 10, faction: 0, state: STATE_RUIN },
    ]);
    const memory: VisionMemory = {
      handles: new Float64Array([4, 5]),
      kind: new Uint16Array([
        idxOfStructure('frontline_td:hive'),
        idxOfStructure('frontline_td:outpost'),
      ]),
      x: new Uint16Array([1, 12]),
      y: new Uint16Array([11, 1]),
      faction: new Uint16Array([2, 0]),
      state: new Uint8Array([STATE_OPERATIONAL, STATE_RUIN]),
    };
    const salvage: ConstructionSalvage = {
      handles: new Float64Array([6]),
      x: new Float32Array([5.5]),
      y: new Float32Array([5.5]),
    };
    const roadWorks: RoadWorks = {
      segments: {
        handles: new Float64Array([7]),
        x: new Float32Array([4.5]),
        y: new Float32Array([4.5]),
        progressBp: new Uint16Array([2000]),
        hpBp: new Uint16Array([10000]),
      },
      projects: {
        offsets: new Uint32Array([0]),
        cells: new Uint32Array([]),
        built: new Uint16Array([]),
        level: new Uint8Array([]),
      },
    };
    const snap = makeSnapshot({
      channels: {
        [StructuresChannel.id]: structures,
        [VisionMemoryChannel.id]: memory,
        [SalvageChannel.id]: salvage,
        [RoadWorksChannel.id]: roadWorks,
      },
    });
    const units = new Map([
      [8, { x: 6.25, y: 7.75, faction: 1 }],
      [9, { x: 11.5, y: 2.5, faction: 2 }],
    ]);

    expect(
      collectSelectionHighlights(
        baseInput({ snapshot: snap, pinned: { kind: 'own_structure', handle: 1 } }),
      ).brackets,
    ).toEqual([{ x: 2, y: 2, w: 2, h: 2, tone: 'pinned_own' }]);

    expect(
      collectSelectionHighlights(
        baseInput({ snapshot: snap, pinned: { kind: 'hostile_structure', handle: 2 } }),
      ).brackets,
    ).toEqual([{ x: 8, y: 3, w: 1, h: 1, tone: 'pinned_hostile' }]);

    expect(
      collectSelectionHighlights(baseInput({ snapshot: snap, pinned: { kind: 'ruin', handle: 3 } }))
        .brackets,
    ).toEqual([{ x: 10, y: 10, w: 3, h: 3, tone: 'pinned_own' }]);

    expect(
      collectSelectionHighlights(
        baseInput({
          snapshot: snap,
          pinned: {
            kind: 'memory',
            handle: 4,
            kindIndex: idxOfStructure('frontline_td:hive'),
            x: 1,
            y: 11,
            faction: 2,
            state: STATE_OPERATIONAL,
          },
        }),
      ).brackets,
    ).toEqual([{ x: 1, y: 11, w: 4, h: 4, tone: 'pinned_hostile' }]);

    expect(
      collectSelectionHighlights(
        baseInput({
          snapshot: snap,
          pinned: {
            kind: 'memory',
            handle: 5,
            kindIndex: idxOfStructure('frontline_td:outpost'),
            x: 12,
            y: 1,
            faction: 0,
            state: STATE_RUIN,
          },
        }),
      ).brackets,
    ).toEqual([{ x: 12, y: 1, w: 3, h: 3, tone: 'pinned_own' }]);

    expect(
      collectSelectionHighlights(
        baseInput({ snapshot: snap, pinned: { kind: 'salvage', handle: 6 } }),
      ).brackets,
    ).toEqual([{ x: 5.5 - 0.45, y: 5.5 - 0.45, w: 0.9, h: 0.9, tone: 'pinned_own' }]);

    expect(
      collectSelectionHighlights(
        baseInput({ snapshot: snap, pinned: { kind: 'road_segment', handle: 7 } }),
      ).brackets,
    ).toEqual([{ x: 4.5 - 0.45, y: 4.5 - 0.45, w: 0.9, h: 0.9, tone: 'pinned_own' }]);

    expect(
      collectSelectionHighlights(
        baseInput({ snapshot: snap, units, pinned: { kind: 'own_unit', handle: 8 } }),
      ).brackets,
    ).toEqual([{ x: 6.25 - 0.45, y: 7.75 - 0.45, w: 0.9, h: 0.9, tone: 'pinned_own' }]);

    expect(
      collectSelectionHighlights(
        baseInput({ snapshot: snap, units, pinned: { kind: 'hostile_unit', handle: 9 } }),
      ).brackets,
    ).toEqual([{ x: 11.5 - 0.45, y: 2.5 - 0.45, w: 0.9, h: 0.9, tone: 'pinned_hostile' }]);
  });

  it('emits hover bracket only when distinct from pinned and danger handles', () => {
    const structures = makeStructures([
      { handle: 1, id: 'frontline_td:turret', x: 2, y: 2, faction: 1 },
      { handle: 2, id: 'frontline_td:turret', x: 5, y: 5, faction: 1 },
    ]);
    const snap = makeSnapshot({ channels: { [StructuresChannel.id]: structures } });

    const distinct = collectSelectionHighlights(
      baseInput({
        snapshot: snap,
        pinned: { kind: 'own_structure', handle: 1 },
        hovered: { kind: 'own_structure', handle: 2 },
      }),
    );
    expect(distinct.brackets).toEqual([
      { x: 2, y: 2, w: 1, h: 1, tone: 'pinned_own' },
      { x: 5, y: 5, w: 1, h: 1, tone: 'hover' },
    ]);

    const sameAsPinned = collectSelectionHighlights(
      baseInput({
        snapshot: snap,
        pinned: { kind: 'own_structure', handle: 1 },
        hovered: { kind: 'own_structure', handle: 1 },
      }),
    );
    expect(sameAsPinned.brackets).toEqual([{ x: 2, y: 2, w: 1, h: 1, tone: 'pinned_own' }]);
  });

  it('emits weapon.range circle for turret and service (4) & connect (20) circles for station', () => {
    const structures = makeStructures([
      { handle: 10, id: 'frontline_td:turret', x: 4, y: 5, faction: 1 },
      { handle: 11, id: 'frontline_td:turret', x: 10, y: 5, faction: 2 },
      { handle: 12, id: 'frontline_td:station', x: 2, y: 8, faction: 1 },
      { handle: 13, id: 'frontline_td:station', x: 12, y: 8, faction: 2 },
    ]);
    const snap = makeSnapshot({ channels: { [StructuresChannel.id]: structures } });

    const ownTurret = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'own_structure', handle: 10 } }),
    );
    expect(ownTurret.circles).toEqual([{ cx: 4.5, cy: 5.5, radius: 8, kind: 'weapon_own' }]);

    const hostileTurret = collectSelectionHighlights(
      baseInput({ snapshot: snap, pinned: { kind: 'hostile_structure', handle: 11 } }),
    );
    expect(hostileTurret.circles).toEqual([
      { cx: 10.5, cy: 5.5, radius: 8, kind: 'weapon_hostile' },
    ]);

    const ownStation = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'own_structure', handle: 12 } }),
    );
    expect(ownStation.circles).toEqual([
      { cx: 3, cy: 9, radius: 4, kind: 'service' },
      { cx: 3, cy: 9, radius: 20, kind: 'connect' },
    ]);

    // Hostile logistics structures do not emit own service/connect rings.
    const hostileStation = collectSelectionHighlights(
      baseInput({ snapshot: snap, hovered: { kind: 'hostile_structure', handle: 13 } }),
    );
    expect(hostileStation.circles).toEqual([]);
  });

  it('emits weapon.range circle for ranged robot and suppresses short-range melee units', () => {
    const denseUnits: DenseUnits = {
      handles: new Float64Array([101, 102, 103]),
      x: new Float32Array([3.2, 6.4, 9.1]),
      y: new Float32Array([4.8, 7.2, 2.3]),
      kind: new Uint16Array([
        idxOfUnit('frontline_td:robot'),
        idxOfUnit('frontline_td:crawler'),
        idxOfUnit('frontline_td:spitter'),
      ]),
      faction: new Uint16Array([1, 2, 2]),
      moving: new Uint8Array([0, 1, 0]),
      hpBp: new Uint16Array([10000, 10000, 10000]),
      energyBp: new Uint16Array([10000, 0xffff, 0xffff]),
    };
    const snap = makeSnapshot({ channels: { [DenseUnitsChannel.id]: denseUnits } });
    const units = new Map([
      [101, { x: 3.25, y: 4.75, faction: 1 }],
      [102, { x: 6.4, y: 7.2, faction: 2 }],
      [103, { x: 9.1, y: 2.3, faction: 2 }],
    ]);

    const robot = collectSelectionHighlights(
      baseInput({ snapshot: snap, units, pinned: { kind: 'own_unit', handle: 101 } }),
    );
    expect(robot.circles).toEqual([{ cx: 3.25, cy: 4.75, radius: 5, kind: 'weapon_own' }]);

    const crawler = collectSelectionHighlights(
      baseInput({ snapshot: snap, units, hovered: { kind: 'hostile_unit', handle: 102 } }),
    );
    expect(crawler.circles).toEqual([]);

    const spitter = collectSelectionHighlights(
      baseInput({ snapshot: snap, units, hovered: { kind: 'hostile_unit', handle: 103 } }),
    );
    expect(spitter.circles).toEqual([{ cx: 9.1, cy: 2.3, radius: 5, kind: 'weapon_hostile' }]);
  });

  it('caps selected structure circles at 8 and deduplicates against focus', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      handle: 200 + i,
      id: 'frontline_td:turret',
      x: i,
      y: 1,
      faction: 1,
    }));
    const snap = makeSnapshot({
      channels: { [StructuresChannel.id]: makeStructures(rows) },
    });
    const selected = new Set(rows.map((r) => r.handle));

    const res = collectSelectionHighlights(
      baseInput({
        snapshot: snap,
        selected,
        hovered: { kind: 'own_structure', handle: 200 },
      }),
    );
    // 1 from focus (handle 200) + 8 from selected (201..208) = 9 circles total.
    expect(res.circles).toHaveLength(9);
    expect(res.circles.filter((c) => c.cx === 0.5 && c.cy === 1.5)).toHaveLength(1);
  });
});
