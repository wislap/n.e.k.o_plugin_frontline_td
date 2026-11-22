// Regression tests for H4 fusion locomotion (ADR 0059):
// mixed-tier MoveIntent shortcut cohesion, contagious local arrival +
// save/restore determinism of blockedByHolder, and C1 spatial aperture narrowing.
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../../../core/index';
import { toFactionId } from '../../../core/index';
import { createSimulation, Faction, InWorld, restoreSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { makeGrid } from '../../../testing/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createTerrainApi } from '../../terrain/sim/index';
import { MoveIntent } from '../protocol';
import { MoveTarget } from './components';
import { createMovementModule, moverComponents } from './module';
import { F1, SURFACES, makeWorld, move, run } from './test-world';

function intentEmitter(queue: { units: number[]; x: number; y: number }[]): SimModule {
  return {
    id: 'frontline_td:test.fusion_emitter',
    install(builder) {
      builder.system({
        id: 'frontline_td:test.fusion_emitter',
        phase: 'command',
        emits: [MoveIntent],
        run(ctx) {
          for (const item of queue.splice(0)) {
            ctx.emit(MoveIntent, item);
          }
        },
      });
    },
  };
}

describe('H4 fusion locomotion (ADR 0059)', () => {
  it('keeps heavy + standard MoveIntent units cohesive via wide pass without taking 1-cell north shortcut', () => {
    // Wall along x=14..16 with a 1-cell north shortcut (y=3) and a 3-cell south pass (y=13..15).
    const rows = Array.from({ length: 19 }, (_, y) =>
      Array.from({ length: 30 }, (__, x) =>
        x >= 14 && x <= 16 && y !== 3 && !(y >= 13 && y <= 15) ? '#' : '.',
      ).join(''),
    );
    const queue: { units: number[]; x: number; y: number }[] = [];
    const units = [
      { x: 6, y: 9, radius: 0.8 },
      { x: 6, y: 10, radius: 0.8 },
      { x: 4, y: 8, radius: 0.35 },
      { x: 4, y: 9, radius: 0.35 },
      { x: 4, y: 10, radius: 0.35 },
      { x: 5, y: 8, radius: 0.35 },
      { x: 5, y: 10, radius: 0.35 },
      { x: 3, y: 9, radius: 0.35 },
    ];
    const world = makeWorld(rows, units, [intentEmitter(queue)]);
    queue.push({ units: world.handles.map(Number), x: 24, y: 9 });

    let minYInGapBand = Infinity;
    for (let t = 0; t < 480; t++) {
      world.sim.step();
      for (let i = 0; i < units.length; i++) {
        const p = world.pos(i);
        if (p.x >= 13.5 && p.x <= 17.5) {
          minYInGapBand = Math.min(minYInGapBand, p.y);
        }
      }
    }

    // Standard units must route with heavy armor through y=13..15 rather than y=3.
    expect(minYInGapBand).toBeGreaterThan(11);
    for (let i = 0; i < units.length; i++) {
      expect(world.active(i)).toBe(2);
      expect(world.pos(i).x).toBeGreaterThan(20);
    }
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('settles packed crowd via contagious arrival and preserves identical mid-run save/restore hashes', () => {
    const rows = Array.from({ length: 12 }, () => '.'.repeat(16));
    const grid = makeGrid(rows);
    const makePairSim = () => {
      const terrain = createTerrainApi(grid, SURFACES);
      const pathing = createPathingModule(terrain, 1);
      const movement = createMovementModule(terrain, pathing.api);
      const handles: EntityHandle[] = [];
      const queue: { units: number[]; x: number; y: number }[] = [];
      const spawner: SimModule = {
        id: 'frontline_td:test.contagious_spawn',
        install(builder) {
          builder.onStart((ctx) => {
            const coords = [
              { x: 10, y: 5 },
              { x: 10, y: 6 },
              { x: 9, y: 5 },
              { x: 9, y: 6 },
              { x: 8, y: 5 },
              { x: 8, y: 6 },
              { x: 7, y: 5 },
              { x: 7, y: 6 },
            ];
            for (const u of coords) {
              handles.push(
                ctx.spawn([
                  [Faction, { id: F1 }],
                  [InWorld],
                  ...moverComponents(u.x + 0.5, u.y + 0.5, 0.125, 0.35, 0),
                ]),
              );
            }
          });
          builder.probe('frontline_td:test.holding_count', (ctx) => {
            const mt = ctx.read(MoveTarget);
            let h = 0;
            for (const id of ctx.query([MoveTarget])) {
              if ((mt.active[id] ?? 0) === 2) {
                h += 1;
              }
            }
            return h;
          });
          builder.probe('frontline_td:test.stalled_count', (ctx) => {
            const mt = ctx.read(MoveTarget);
            let s = 0;
            for (const id of ctx.query([MoveTarget])) {
              if ((mt.stall[id] ?? 0) > 0) {
                s += 1;
              }
            }
            return s;
          });
        },
      };
      const config: SimConfig = {
        seed: 19,
        factions: [{ id: F1 }, { id: toFactionId(2) }],
        relations: [],
        grid: { width: grid.width, height: grid.height },
        rngStreams: [],
        controllers: [],
      };
      return {
        config,
        modules: [pathing.module, movement, spawner, intentEmitter(queue)],
        handles,
        queue,
      };
    };

    const a = makePairSim();
    const simA = createSimulation(a.config, a.modules);
    simA.step();
    // Hold 2 front units at (10,5)/(10,6), then march behind units onto the same cells (all with explicit same target).
    a.queue.push({ units: [Number(a.handles[0])], x: 10, y: 5 });
    a.queue.push({ units: [Number(a.handles[1])], x: 10, y: 6 });
    for (let t = 0; t < 6; t++) {
      simA.step();
    }
    expect(simA.probes()['frontline_td:test.holding_count']).toBe(2);

    a.queue.push({ units: a.handles.slice(2).map(Number), x: 10, y: 5 });
    for (let t = 0; t < 16; t++) {
      simA.step();
    }

    const saved = simA.serialize();
    for (let t = 0; t < 120; t++) {
      simA.step();
    }
    expect(simA.probes()['frontline_td:test.holding_count']).toBe(8);

    const b = makePairSim();
    const simB = restoreSimulation(b.config, b.modules, saved);
    for (let t = 0; t < 120; t++) {
      simB.step();
    }
    expect(simB.hash()).toBe(simA.hash());
  });

  it('narrows a wide rank smoothly through a 2-cell bottleneck and arrives cleanly without goal leaks', () => {
    // Open bays east & west connected by a 2-cell wide corridor (y=8..9) at x=12..16.
    const rows = Array.from({ length: 18 }, (_, y) =>
      Array.from({ length: 30 }, (__, x) =>
        x >= 12 && x <= 16 && y !== 8 && y !== 9 ? '#' : '.',
      ).join(''),
    );
    const rankUnits = Array.from({ length: 6 }, (_, i) => ({ x: 6, y: 6 + i, radius: 0.35 }));
    const world = makeWorld(rows, rankUnits);
    world.sim.submit(move(world.handles, 23, 8));

    let enteredCorridor = false;
    let maxCorridorYSpread = 0;
    for (let t = 0; t < 420; t++) {
      world.sim.step();
      let minY = Infinity;
      let maxY = -Infinity;
      let inBand = 0;
      for (let i = 0; i < rankUnits.length; i++) {
        const p = world.pos(i);
        if (p.x >= 12 && p.x <= 17) {
          enteredCorridor = true;
          inBand += 1;
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      if (inBand >= 2) {
        maxCorridorYSpread = Math.max(maxCorridorYSpread, maxY - minY);
      }
    }
    run(world, 30);

    expect(enteredCorridor).toBe(true);
    expect(maxCorridorYSpread).toBeLessThanOrEqual(2.0);
    for (let i = 0; i < rankUnits.length; i++) {
      expect(world.active(i)).toBe(2);
      expect(world.pos(i).x).toBeGreaterThan(19);
    }
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });
});
