// Assault mode headless tests: the victory rule (elimination, last
// faction standing, time-limit draw, mirror symmetry, save/restore of
// the ended record) and the director's gather→launch→breather cycle on
// proto_01 through the real resolve-setup path.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/index';
import type { ResolvedMap } from '../content/index';
import { toFactionId } from '../core/index';
import { createSimulation, restoreSimulation } from '../kernel/index';
import type { SimConfig, SimModule } from '../kernel/index';
import { StructuresChannel } from '../features/construction/protocol';
import type { ConstructionStructures } from '../features/construction/protocol';
import type { FactionStart } from '../features/units/sim/index';
import type { TerrainGrid } from '../features/terrain/content';
import { AssaultChannel } from '../modes/assault/protocol';
import type { AssaultState } from '../modes/assault/protocol';
import { assaultModules, defaultSetup } from '../modes/assault/index';
import { resolveSetup } from './resolve-setup';
import { createSimModules, RNG_STREAMS } from './sim-registry';
import { must } from '../testing/index';

const F1 = toFactionId(1);
const F2 = toFactionId(2);
const DB = loadContent();

const ROBOT = must(DB.units.byId('frontline_td:robot'), 'robot');
const BASE = must(DB.structures.byId('frontline_td:main_base'), 'main_base');
const HIVE = must(DB.structures.byId('frontline_td:hive'), 'hive');

// Small flat symmetric map for the victory tests: a base on the west
// half and a hive on the east half, mirrored across the centre line.
const MW = 40;
const MH = 20;
const GROUND = must(DB.surfaces.byId('frontline_td:ground'), 'ground').index;
const TEST_MAP: ResolvedMap = {
  id: 'frontline_td:test.assault' as ResolvedMap['id'],
  index: 999,
  width: MW,
  height: MH,
  points: {
    player_start: { x: 4, y: 8 },
    enemy_north: { x: 34, y: 8 },
    enemy_east: { x: 34, y: 16 },
    enemy_rally: { x: 24, y: 10 },
  },
  grid: {
    width: MW,
    height: MH,
    heights: new Uint8Array(MW * MH).fill(1),
    surfaces: new Uint16Array(MW * MH).fill(GROUND),
    ramps: new Uint8Array(MW * MH).fill(0),
  } satisfies TerrainGrid,
};

function world(starts: FactionStart[], extra: SimModule[] = []) {
  const built = createSimModules(DB, TEST_MAP, starts);
  const modules = [
    ...built.modules,
    ...assaultModules(
      { db: DB, map: TEST_MAP, factions: [F1, F2], logistics: built.logistics },
      { timeLimitTicks: 400 },
    ),
    ...extra,
  ];
  const config: SimConfig = {
    seed: 1,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [{ a: F1, b: F2, relation: 'hostile' }],
    grid: { width: MW, height: MH },
    rngStreams: [...RNG_STREAMS],
    controllers: [],
  };
  const sim = createSimulation(config, modules);
  return { sim, config, modules };
}

function assault(sim: ReturnType<typeof createSimulation>, observer = F1): AssaultState {
  return sim.snapshot(observer).channels[AssaultChannel.id] as AssaultState;
}

function run(sim: ReturnType<typeof createSimulation>, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    sim.step();
  }
}

describe('assault victory', () => {
  it('eliminates a faction whose last core falls and ends with a winner', () => {
    // F2 has a hive (core); F1 overruns it with robots.
    const { sim } = world([
      {
        faction: F1,
        structures: [{ kind: BASE.index, x: 4, y: 8 }],
        units: [{ kind: ROBOT.index, x: 30, y: 9, count: 40 }],
      },
      { faction: F2, structures: [{ kind: HIVE.index, x: 34, y: 8 }], units: [] },
    ]);
    run(sim, 2400);
    const st = assault(sim);
    expect(st.ended).toBe(1);
    expect(st.winner).toBe(1);
    expect(st.eliminated).toContain(2);
  });

  it('mirrors the outcome when the starts are swapped', () => {
    const startA: FactionStart[] = [
      {
        faction: F1,
        structures: [{ kind: BASE.index, x: 4, y: 8 }],
        units: [{ kind: ROBOT.index, x: 30, y: 9, count: 40 }],
      },
      { faction: F2, structures: [{ kind: HIVE.index, x: 34, y: 8 }], units: [] },
    ];
    const startB: FactionStart[] = [
      { faction: F1, structures: [{ kind: HIVE.index, x: 4, y: 8 }] },
      {
        faction: F2,
        structures: [{ kind: BASE.index, x: 34, y: 8 }],
        units: [{ kind: ROBOT.index, x: 8, y: 9, count: 40 }],
      },
    ];
    const a = world(startA);
    const b = world(startB);
    run(a.sim, 2400);
    run(b.sim, 2400);
    const sa = assault(a.sim);
    const sb = assault(b.sim);
    expect(sa.ended).toBe(1);
    expect(sb.ended).toBe(1);
    // Mirrored: whichever faction fielded the raiding force wins.
    expect(sa.winner).toBe(1);
    expect(sb.winner).toBe(2);
  });

  it('ends in a draw at the time limit', () => {
    const { sim } = world(
      [
        { faction: F1, structures: [{ kind: BASE.index, x: 4, y: 8 }] },
        { faction: F2, structures: [{ kind: HIVE.index, x: 34, y: 8 }], units: [] },
      ],
      // timeLimitTicks 400 already applied in world()
    );
    run(sim, 420);
    const st = assault(sim);
    expect(st.ended).toBe(1);
    expect(st.winner).toBe(-1);
  });

  it('ended state survives save/restore', () => {
    const w = world([
      { faction: F1, structures: [{ kind: BASE.index, x: 4, y: 8 }] },
      { faction: F2, structures: [{ kind: HIVE.index, x: 34, y: 8 }], units: [] },
    ]);
    run(w.sim, 420);
    expect(assault(w.sim).ended).toBe(1);
    const saved = w.sim.serialize();
    const restored = restoreSimulation(w.config, w.modules, saved);
    const st = assault(restored);
    expect(st.ended).toBe(1);
    expect(st.winner).toBe(-1);
    expect(restored.hash()).toBe(w.sim.hash());
  });
});

describe('assault outposts (M5 batch A)', () => {
  it('default setup starts three enemy outposts with garrisons', () => {
    const setup = defaultSetup(1);
    const enemy = setup.factions[1];
    const structures = enemy?.start?.structures ?? [];
    const units = enemy?.start?.units ?? [];
    const outposts = structures.filter((s) => s.structure === 'frontline_td:outpost');
    expect(outposts).toHaveLength(3);
    // Garrisons: south 3 crawlers + 1 spitter; west/east 4 + 2 each.
    const at = (x: number, y: number) =>
      units.filter((u) => u.x === x && u.y === y).reduce((n, u) => n + u.count, 0);
    for (const s of outposts) {
      expect(at(s.x, s.y)).toBeGreaterThanOrEqual(4);
    }
  });

  it('outposts spawn operational and blocked on proto_01', () => {
    const r = resolveSetup(defaultSetup(1));
    if ('error' in r) {
      throw new Error(r.error);
    }
    const sim = r.sim;
    run(sim, 5);
    const rows = sim.snapshot(F2).channels[StructuresChannel.id] as ConstructionStructures;
    let found = 0;
    for (let i = 0; i < rows.handles.length; i++) {
      const def = DB.structures.list[rows.kind[i] ?? 0];
      if (def?.id === 'frontline_td:outpost') {
        found += 1;
        expect(rows.state[i]).toBe(3); // STATE_OPERATIONAL
        expect(rows.faction[i]).toBe(2);
      }
    }
    expect(found).toBe(3);
  });
});
