// Units feature tests (B5): start-state spawn placement and the dense
// snapshot channel shape/ordering.
import { describe, expect, it } from 'vitest';
import { contentId, toFactionId, toTick } from '../../../core/index';
import type { EntityHandle } from '../../../core/index';
import { loadContent } from '../../../content/load';
import { createSimulation } from '../../../kernel/index';
import type { SimConfig } from '../../../kernel/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createTerrainModule } from '../../terrain/sim/index';
import { createMovementModule, MoveCommand } from '../../movement/sim/index';
import { createUnitsModule } from './index';
import { denseUnits } from '../../../testing/index';

const F1 = toFactionId(1);
const F2 = toFactionId(2);

function makeSim(starts: Parameters<typeof createUnitsModule>[2]) {
  const db = loadContent();
  const map = db.maps.byId(contentId('frontline_td:proto_01'));
  if (map === undefined) {
    throw new Error('proto_01 missing');
  }
  const terrain = createTerrainModule(map.grid, db.surfaces.list);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  const movement = createMovementModule(terrain.api, pathing.api);
  const units = createUnitsModule(db, terrain.api, starts);
  const config: SimConfig = {
    seed: 5,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [],
    grid: { width: map.width, height: map.height },
    rngStreams: [],
    controllers: [],
  };
  const sim = createSimulation(config, [terrain.module, pathing.module, movement, units]);
  return { sim, db, terrain: terrain.api };
}

describe('units', () => {
  it('spawns start-state units on passable cells', () => {
    const robot = 0;
    const { sim, terrain } = makeSim([
      { faction: F1, units: [{ kind: robot, x: 10, y: 52, count: 25 }] },
    ]);
    const d = denseUnits(sim, F1);
    expect(d.handles.length).toBe(25);
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const cx = Math.floor(d.x[i] ?? 0);
      const cy = Math.floor(d.y[i] ?? 0);
      expect(terrain.passable(cx, cy, 0), `cell ${cx},${cy}`).toBe(true);
      // One unit per cell.
      expect(seen.has(`${cx},${cy}`)).toBe(false);
      seen.add(`${cx},${cy}`);
      expect(d.faction[i]).toBe(1);
      expect(d.kind[i]).toBe(robot);
    }
  });

  it('dense channel is ordered by entity id with equal-length arrays', () => {
    const { sim } = makeSim([
      { faction: F1, units: [{ kind: 0, x: 10, y: 52, count: 10 }] },
      { faction: F2, units: [{ kind: 0, x: 30, y: 4, count: 5 }] },
    ]);
    const d = denseUnits(sim, F1);
    expect(d.handles.length).toBe(15);
    for (const arr of [d.x, d.y, d.kind, d.faction, d.moving]) {
      expect(arr.length).toBe(15);
    }
    for (let i = 1; i < 15; i++) {
      expect(d.handles[i] ?? 0).toBeGreaterThan(d.handles[i - 1] ?? 0);
    }
    const factions = new Set<number>();
    for (let i = 0; i < 15; i++) {
      factions.add(d.faction[i] ?? 0);
    }
    expect([...factions].sort()).toEqual([1, 2]);
    expect([...d.moving].every((m) => m === 0)).toBe(true);
  });

  it('reports moving units in the dense channel', () => {
    // Use the full module stack from makeSim plus a move command at tick 1.
    const db = loadContent();
    const map = db.maps.byId(contentId('frontline_td:proto_01'));
    if (map === undefined) {
      throw new Error('proto_01 missing');
    }
    const terrain = createTerrainModule(map.grid, db.surfaces.list);
    const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
    const movement = createMovementModule(terrain.api, pathing.api);
    const units = createUnitsModule(db, terrain.api, [
      { faction: F1, units: [{ kind: 0, x: 10, y: 52, count: 3 }] },
    ]);
    const sim = createSimulation(
      {
        seed: 5,
        factions: [{ id: F1 }],
        relations: [],
        grid: { width: map.width, height: map.height },
        rngStreams: [],
        controllers: [],
      },
      [terrain.module, pathing.module, movement, units],
    );
    const before = denseUnits(sim, F1);
    const handles = [...before.handles].map((h) => h as EntityHandle);
    sim.submit({
      tick: toTick(1),
      issuer: F1,
      type: MoveCommand.type,
      payload: { units: handles.slice(0, 2), x: 20, y: 52 },
    });
    sim.step();
    sim.step();
    const after = denseUnits(sim, F1);
    const moving = [...after.moving].filter((m) => m === 1).length;
    expect(moving).toBe(2);
  });
});
