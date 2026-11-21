// Unit spawn intent (A3): the capture_fog resolver picks the nearest
// passable free cell in the start-spawn spiral, emits units.spawned when
// the handle is known, and the entity becomes query-visible next tick.
import { describe, expect, it } from 'vitest';
import { contentId, toFactionId } from '../../../core/index';
import type { Serializable } from '../../../core/index';
import { loadContent } from '../../../content/load';
import type { ContentDb, ResolvedSurface } from '../../../content/load';
import { createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { createMovementModule } from '../../movement/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createTerrainModule } from '../../terrain/sim/index';
import { SpawnIntent, UnitsSpawned } from '../protocol';
import { createUnitsModule } from './index';
import type { FactionStart } from './index';
import { denseUnits, makeGrid } from '../../../testing/index';

const F1 = toFactionId(1);
const HEAVY_ID = contentId('frontline_td:heavy_test');
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

function makeHeavyDb(): ContentDb {
  const base = loadContent();
  const robot = base.units.list[0];
  if (robot === undefined) {
    throw new Error('base robot unit missing');
  }
  const heavy = {
    ...robot,
    id: HEAVY_ID,
    index: base.units.list.length,
    radius: 0.8,
  };
  const list = [...base.units.list, heavy];
  const byId = new Map<string, (typeof list)[number]>(list.map((u) => [u.id, u]));
  return {
    ...base,
    units: {
      byId: (id) => byId.get(id),
      byIndex: (index) => list[index],
      list,
    },
  };
}

function makeHeavySim(
  rows: string[],
  starts: readonly FactionStart[],
  extra: readonly SimModule[],
) {
  const db = makeHeavyDb();
  const grid = makeGrid(rows);
  const terrain = createTerrainModule(grid, SURFACES);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  const movement = createMovementModule(terrain.api, pathing.api);
  const units = createUnitsModule(db, terrain.api, starts);
  const config: SimConfig = {
    seed: 5,
    factions: [{ id: F1 }],
    relations: [],
    grid: { width: grid.width, height: grid.height },
    rngStreams: [],
    controllers: [],
  };
  const sim = createSimulation(config, [terrain.module, pathing.module, movement, units, ...extra]);
  return { sim, terrain: terrain.api, db };
}

function makeSim(extra: readonly SimModule[]) {
  const db = loadContent();
  const map = db.maps.byId(contentId('frontline_td:proto_01'));
  if (map === undefined) {
    throw new Error('proto_01 missing');
  }
  const terrain = createTerrainModule(map.grid, db.surfaces.list);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  const movement = createMovementModule(terrain.api, pathing.api);
  const units = createUnitsModule(db, terrain.api, []);
  const config: SimConfig = {
    seed: 5,
    factions: [{ id: F1 }],
    relations: [],
    grid: { width: map.width, height: map.height },
    rngStreams: [],
    controllers: [],
  };
  const sim = createSimulation(config, [terrain.module, pathing.module, movement, units, ...extra]);
  return { sim, terrain: terrain.api };
}

function emitter(queue: Serializable[]): SimModule {
  return {
    id: 'frontline_td:test.emitter',
    install(builder) {
      builder.system({
        id: 'frontline_td:test.emitter',
        phase: 'command',
        emits: [SpawnIntent],
        run(ctx) {
          for (const payload of queue.splice(0)) {
            ctx.emit(SpawnIntent, payload as never);
          }
        },
      });
    },
  };
}

describe('units.spawn', () => {
  it('spawns a unit next tick at the nearest free cell and emits spawned', () => {
    const queue: Serializable[] = [
      { faction: 1, kind: 'frontline_td:robot', x: 30.5, y: 30.5, source: 0 },
    ];
    const { sim } = makeSim([emitter(queue)]);
    const before = denseUnits(sim, F1).handles.length;
    sim.step();
    // The spawn lands structurally at tick end: visible from tick 1.
    const events = sim.snapshot(F1).events;
    expect(denseUnits(sim, F1).handles.length).toBe(before + 1);
    expect(events.some((e) => e.type === UnitsSpawned.type)).toBe(true);
    const x = denseUnits(sim, F1).x[before] ?? -1;
    const y = denseUnits(sim, F1).y[before] ?? -1;
    // Nearest passable free cell around the requested point.
    expect(Math.abs(x - 30.5)).toBeLessThan(3);
    expect(Math.abs(y - 30.5)).toBeLessThan(3);
  });

  it('ignores an unknown unit kind', () => {
    const queue: Serializable[] = [
      { faction: 1, kind: 'frontline_td:nope', x: 30.5, y: 30.5, source: 0 },
    ];
    const { sim } = makeSim([emitter(queue)]);
    const before = denseUnits(sim, F1).handles.length;
    sim.step();
    expect(denseUnits(sim, F1).handles.length).toBe(before);
    expect(sim.snapshot(F1).events.some((e) => e.type === UnitsSpawned.type)).toBe(false);
  });

  it('later intents fill distinct cells of the spiral', () => {
    const queue: Serializable[] = [
      { faction: 1, kind: 'frontline_td:robot', x: 30.5, y: 30.5, source: 0 },
      { faction: 1, kind: 'frontline_td:robot', x: 30.5, y: 30.5, source: 0 },
    ];
    const { sim } = makeSim([emitter(queue)]);
    const before = denseUnits(sim, F1).handles.length;
    sim.step();
    const d = denseUnits(sim, F1);
    expect(d.handles.length).toBe(before + 2);
    const c0 = `${d.x[before]},${d.y[before]}`;
    const c1 = `${d.x[before + 1]},${d.y[before + 1]}`;
    expect(c0).not.toBe(c1);
  });

  it('places tier=1 heavy units on 2x2 passable anchors at (x+1,y+1), skipping 1-cell gaps without overlap', () => {
    const rows = ['########', '#.#....#', '###....#', '#......#', '########'];
    const queue: Serializable[] = [
      // (1, 1) is a 1-cell narrow gap: heavy unit must skip it and land at anchor (3, 1) -> (4, 2).
      { faction: 1, kind: HEAVY_ID, x: 1.5, y: 1.5, source: 0 },
    ];
    const { sim, terrain, db } = makeHeavySim(rows, [], [emitter(queue)]);
    sim.step();
    const d1 = denseUnits(sim, F1);
    expect(d1.handles.length).toBe(1);
    expect(d1.x[0]).toBe(4);
    expect(d1.y[0]).toBe(2);
    expect(terrain.passable((d1.x[0] ?? 0) - 1, (d1.y[0] ?? 0) - 1, 0, 1)).toBe(true);

    // Next tick: live heavy unit occupies 2x2 {3,4}x{1,2}, so a second spawn at (3.5, 1.5)
    // must pick a disjoint 2x2 anchor (Chebyshev center distance >= 2).
    queue.push({ faction: 1, kind: HEAVY_ID, x: 3.5, y: 1.5, source: 0 });
    sim.step();
    const d2 = denseUnits(sim, F1);
    expect(d2.handles.length).toBe(2);
    const dx = Math.abs((d2.x[0] ?? 0) - (d2.x[1] ?? 0));
    const dy = Math.abs((d2.y[0] ?? 0) - (d2.y[1] ?? 0));
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(2);
    expect(terrain.passable((d2.x[1] ?? 0) - 1, (d2.y[1] ?? 0) - 1, 0, 1)).toBe(true);

    // Also verify onStart heavy placement keeps adjacent 2x2 footprints disjoint.
    const heavyIndex = db.units.byId(HEAVY_ID)?.index ?? -1;
    const startSim = makeHeavySim(
      rows,
      [{ faction: F1, units: [{ kind: heavyIndex, x: 1, y: 1, count: 2 }] }],
      [],
    );
    const ds = denseUnits(startSim.sim, F1);
    expect(ds.handles.length).toBe(2);
    expect(ds.x[0]).toBe(4);
    expect(ds.y[0]).toBe(2);
    const sdx = Math.abs((ds.x[0] ?? 0) - (ds.x[1] ?? 0));
    const sdy = Math.abs((ds.y[0] ?? 0) - (ds.y[1] ?? 0));
    expect(Math.max(sdx, sdy)).toBeGreaterThanOrEqual(2);
  });
});
