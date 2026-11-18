// Unit spawn intent (A3): the capture_fog resolver picks the nearest
// passable free cell in the start-spawn spiral, emits units.spawned when
// the handle is known, and the entity becomes query-visible next tick.
import { describe, expect, it } from 'vitest';
import { contentId, toFactionId } from '../../../core/index';
import type { Serializable } from '../../../core/index';
import { loadContent } from '../../../content/load';
import { createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { createMovementModule } from '../../movement/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createTerrainModule } from '../../terrain/sim/index';
import { SpawnIntent, UnitsSpawned } from '../protocol';
import { createUnitsModule } from './index';
import { denseUnits } from '../../../testing/index';

const F1 = toFactionId(1);

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
});
