// Spatial clustering + shared topological wide-gate corridor chains (ADR 0056):
// watershed split immunity, cluster/wall independence, wide-gate lateral span,
// dynamic blocker self-healing, and mid-march save/restore determinism.
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../../../core/index';
import { toFactionId } from '../../../core/index';
import { createSimulation, Faction, InWorld, restoreSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import { createPathingModule } from '../../pathing/sim/index';
import { createTerrainApi } from '../../terrain/sim/index';
import { makeGrid } from '../../../testing/index';
import { RouteFollow } from './components';
import { createMovementModule, moverComponents } from './module';
import { F1, SURFACES, makeWorld, move, run } from './test-world';

function obstacleMap(
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): string[] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (__, x) =>
      x >= x0 && x <= x1 && y >= y0 && y <= y1 ? '#' : '.',
    ).join(''),
  );
}

describe('route chains & spatial clustering (ADR 0056)', () => {
  it('eliminates watershed splits across a centered obstacle for a coherent platoon', () => {
    const rows = obstacleMap(40, 30, 16, 24, 12, 16);
    // 4x4 platoon centered at x=20.0 (west of obstacle midline 20.5), with the
    // rightmost column at x=21.5 on the eastern watershed half.
    const units = [];
    for (let y = 22; y <= 25; y++) {
      for (let x = 18; x <= 21; x++) {
        units.push({ x, y });
      }
    }
    const world = makeWorld(rows, units);
    world.sim.submit(move(world.handles, 20, 4));

    const maxXInBand = new Array<number>(units.length).fill(-Infinity);
    const minXInBand = new Array<number>(units.length).fill(Infinity);
    for (let t = 0; t < 450; t++) {
      world.sim.step();
      for (let i = 0; i < units.length; i++) {
        const p = world.pos(i);
        if (p.y >= 12 && p.y <= 17) {
          maxXInBand[i] = Math.max(maxXInBand[i] ?? -Infinity, p.x);
          minXInBand[i] = Math.min(minXInBand[i] ?? Infinity, p.x);
        }
      }
    }

    for (let i = 0; i < units.length; i++) {
      expect(maxXInBand[i]).toBeLessThan(16);
      expect(minXInBand[i]).toBeGreaterThanOrEqual(0);
      expect(world.active(i)).toBe(2);
    }
    expect(world.pathingApi.goalRefCount(world.goals.at(-1) ?? -1)).toBe(0);
  });

  it('keeps distant clusters and cross-wall groups independent', () => {
    const rows = obstacleMap(40, 30, 16, 24, 12, 16);
    const westUnits = [
      { x: 4, y: 22 },
      { x: 5, y: 22 },
      { x: 4, y: 23 },
      { x: 5, y: 23 },
    ];
    const eastUnits = [
      { x: 34, y: 22 },
      { x: 35, y: 22 },
      { x: 34, y: 23 },
      { x: 35, y: 23 },
    ];
    const world = makeWorld(rows, [...westUnits, ...eastUnits]);
    world.sim.submit(move(world.handles, 20, 4));

    const westMaxX = new Array<number>(westUnits.length).fill(-Infinity);
    const eastMinX = new Array<number>(eastUnits.length).fill(Infinity);
    for (let t = 0; t < 450; t++) {
      world.sim.step();
      for (let i = 0; i < westUnits.length; i++) {
        const p = world.pos(i);
        if (p.y >= 11.5 && p.y <= 17.5) {
          westMaxX[i] = Math.max(westMaxX[i] ?? -Infinity, p.x);
        }
      }
      for (let i = 0; i < eastUnits.length; i++) {
        const p = world.pos(westUnits.length + i);
        if (p.y >= 11.5 && p.y <= 17.5) {
          eastMinX[i] = Math.min(eastMinX[i] ?? Infinity, p.x);
        }
      }
    }
    for (let i = 0; i < westUnits.length; i++) {
      expect(westMaxX[i]).toBeLessThan(16);
      expect(world.active(i)).toBe(2);
    }
    for (let i = 0; i < eastUnits.length; i++) {
      expect(eastMinX[i]).toBeGreaterThan(25);
      expect(world.active(westUnits.length + i)).toBe(2);
    }

    // Two units 4 cells apart across an impassable divider must not stall or share a cross-wall chain.
    const wallRows = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 13 }, (__, x) => (x === 6 && y >= 2 ? '#' : '.')).join(''),
    );
    const wallWorld = makeWorld(wallRows, [
      { x: 4, y: 10 },
      { x: 8, y: 10 },
    ]);
    wallWorld.sim.submit(move(wallWorld.handles, 6, 1));
    run(wallWorld, 300);
    expect(wallWorld.active(0)).toBe(2);
    expect(wallWorld.active(1)).toBe(2);
    expect(wallWorld.pos(0).y).toBeLessThan(3);
    expect(wallWorld.pos(1).y).toBeLessThan(3);
  });

  it('preserves lateral spread through wide gaps and self-heals on dynamic blockers', () => {
    // Wide pass x=2..11 across y=11..13; obstacle blocks x=0..1 and x=12..39.
    const wideRows = Array.from({ length: 26 }, (_, y) =>
      Array.from({ length: 40 }, (__, x) =>
        y >= 11 && y <= 13 && (x <= 1 || x >= 12) ? '#' : '.',
      ).join(''),
    );
    const rankUnits = Array.from({ length: 6 }, (_, i) => ({ x: 14 + i, y: 20 }));
    const wideWorld = makeWorld(wideRows, rankUnits);
    wideWorld.sim.submit(move(wideWorld.handles, 16, 4));

    let maxSpanAtCorridor = 0;
    for (let t = 0; t < 420; t++) {
      wideWorld.sim.step();
      let minX = Infinity;
      let maxX = -Infinity;
      let countInBand = 0;
      for (let i = 0; i < rankUnits.length; i++) {
        const p = wideWorld.pos(i);
        if (p.y >= 10.5 && p.y <= 14.5) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          countInBand += 1;
        }
      }
      if (countInBand >= 4) {
        maxSpanAtCorridor = Math.max(maxSpanAtCorridor, maxX - minX);
      }
    }
    expect(maxSpanAtCorridor).toBeGreaterThan(1.8);
    for (let i = 0; i < rankUnits.length; i++) {
      expect(wideWorld.active(i)).toBe(2);
    }

    // Dynamic blocker seals the traced north gap mid-march: units reroute via south gap.
    const healRows = obstacleMap(30, 20, 12, 16, 7, 11);
    const healUnits = [];
    for (let y = 5; y <= 6; y++) {
      for (let x = 6; x <= 8; x++) {
        healUnits.push({ x, y });
      }
    }
    const healWorld = makeWorld(healRows, healUnits);
    healWorld.sim.submit(move(healWorld.handles, 23, 9));
    run(healWorld, 15);
    const sealCells: { x: number; y: number }[] = [];
    for (let y = 0; y <= 6; y++) {
      for (let x = 12; x <= 16; x++) {
        sealCells.push({ x, y });
      }
    }
    healWorld.terrain.setBlocked(sealCells, true);
    run(healWorld, 450);
    for (let i = 0; i < healUnits.length; i++) {
      expect(healWorld.active(i)).toBe(2);
      expect(healWorld.pos(i).x).toBeGreaterThan(20);
    }
    expect(healWorld.pathingApi.goalRefCount(healWorld.goals.at(-1) ?? -1)).toBe(0);
  });

  it('reproduces identical mid-march hashes across save/restore with active RouteFollow', () => {
    const rows = obstacleMap(40, 30, 16, 24, 12, 16);
    const grid = makeGrid(rows);
    const makePairSim = () => {
      const terrain = createTerrainApi(grid, SURFACES);
      const pathing = createPathingModule(terrain, 1);
      const movement = createMovementModule(terrain, pathing.api);
      const handles: EntityHandle[] = [];
      let routeActiveCount = 0;
      const spawner: SimModule = {
        id: 'frontline_td:test.rc_spawn',
        install(builder) {
          builder.onStart((ctx) => {
            for (let y = 22; y <= 24; y++) {
              for (let x = 18; x <= 21; x++) {
                handles.push(
                  ctx.spawn([
                    [Faction, { id: F1 }],
                    [InWorld],
                    ...moverComponents(x + 0.5, y + 0.5, 0.125, 0.35, 0),
                  ]),
                );
              }
            }
          });
          builder.probe('frontline_td:test.route_active', (ctx) => {
            const rf = ctx.read(RouteFollow);
            let n = 0;
            for (const id of ctx.query([RouteFollow])) {
              if ((rf.active[id] ?? 0) === 1) {
                n += 1;
              }
            }
            routeActiveCount = n;
            return n;
          });
        },
      };
      const config: SimConfig = {
        seed: 7,
        factions: [{ id: F1 }, { id: toFactionId(2) }],
        relations: [],
        grid: { width: grid.width, height: grid.height },
        rngStreams: [],
        controllers: [],
      };
      return {
        config,
        modules: [pathing.module, movement, spawner],
        handles,
        routeActiveCount: () => routeActiveCount,
      };
    };

    const a = makePairSim();
    const simA = createSimulation(a.config, a.modules);
    simA.step();
    simA.submit(move(a.handles, 20, 4, 2));
    for (let t = 0; t < 40; t++) {
      simA.step();
    }
    const midActive = simA.probes()['frontline_td:test.route_active'] ?? 0;
    expect(midActive).toBeGreaterThan(0);

    const saved = simA.serialize();
    for (let t = 0; t < 260; t++) {
      simA.step();
    }

    const b = makePairSim();
    const simB = restoreSimulation(b.config, b.modules, saved);
    expect(simB.probes()['frontline_td:test.route_active']).toBe(midActive);
    for (let t = 0; t < 260; t++) {
      simB.step();
    }
    expect(simB.hash()).toBe(simA.hash());
  });
});
