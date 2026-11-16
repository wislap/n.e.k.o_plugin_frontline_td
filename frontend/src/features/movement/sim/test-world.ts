// Shared movement test harness: ASCII map helper, a wired-up world with
// goal acquire/release tracking and per-unit probes, and command helpers.
import type { CommandEnvelope, EntityHandle } from '../../../core/index';
import { COMMAND_REJECTED, contentId, toFactionId, toTick } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { Faction, InWorld } from '../../../kernel/index';
import { createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainApi } from '../../terrain/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { MoveTarget, Mover, Position } from './components';
import { createMovementModule, moverComponents } from './module';
import { MoveCommand } from '../protocol';

export const CLS = 0;
export const F1 = toFactionId(1);
const F2 = toFactionId(2);
export const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];
const SPEED = 0.125; // cells/tick (robot: 2.5 cells/s)
const RADIUS = 0.35;

// '.': ground h0, '#': impassable, 'r': ramp h0, digit: ground at height.
export function makeGrid(rows: string[]): TerrainGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const heights = new Uint8Array(width * height);
  const surfaces = new Uint16Array(width * height);
  const ramps = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const idx = y * width + x;
      if (ch === '#') {
        surfaces[idx] = 1;
      } else if (ch === 'r') {
        ramps[idx] = 1;
      } else if (ch !== undefined && ch >= '1' && ch <= '9') {
        heights[idx] = ch.charCodeAt(0) - 48;
      }
    }
  });
  return { width, height, heights, surfaces, ramps };
}

export interface SpawnUnit {
  x: number;
  y: number;
  faction?: number;
}

export interface World {
  sim: ReturnType<typeof createSimulation>;
  handles: EntityHandle[];
  terrain: TerrainApi;
  pathingApi: PathingApi;
  // All goal ids ever acquired / released, in order.
  goals: number[];
  released: number[];
  pos(i: number): { x: number; y: number };
  active(i: number): number;
  slot(i: number): { x: number; y: number };
}

export function makeWorld(rows: string[], units: SpawnUnit[]): World {
  const grid = makeGrid(rows);
  const terrain = createTerrainApi(grid, SURFACES);
  const pathing = createPathingModule(terrain, 1);
  const goals: number[] = [];
  const released: number[] = [];
  const pathingApi: PathingApi = {
    ...pathing.api,
    acquireGoal(x: number, y: number, cls: number): number {
      const id = pathing.api.acquireGoal(x, y, cls);
      goals.push(id);
      return id;
    },
    releaseGoal(goalId: number): void {
      released.push(goalId);
      pathing.api.releaseGoal(goalId);
    },
  };
  const movement = createMovementModule(terrain, pathingApi);
  const handles: EntityHandle[] = [];
  const spawner: SimModule = {
    id: 'frontline_td:test.spawn',
    install(builder) {
      builder.onStart((ctx) => {
        for (const u of units) {
          handles.push(
            ctx.spawn([
              [Faction, { id: u.faction ?? 1 }],
              [InWorld],
              ...moverComponents(u.x + 0.5, u.y + 0.5, SPEED, RADIUS, CLS),
            ]),
          );
        }
      });
      units.forEach((u, i) => {
        builder.probe(`frontline_td:test.u${i}x`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(Position).x[id] ?? -1);
        });
        builder.probe(`frontline_td:test.u${i}y`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(Position).y[id] ?? -1);
        });
        builder.probe(`frontline_td:test.u${i}a`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(MoveTarget).active[id] ?? -1);
        });
        builder.probe(`frontline_td:test.u${i}tx`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(MoveTarget).x[id] ?? -1);
        });
        builder.probe(`frontline_td:test.u${i}ty`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(MoveTarget).y[id] ?? -1);
        });
      });
      // Passability property (B5): every unit's cell must stay passable, and
      // a height change is only legal when one of the two cells is a ramp
      // (i.e. no cliff crossing, including from separation pushes).
      const prevCell = new Map<number, number>();
      builder.system({
        id: 'frontline_td:test.check',
        phase: 'cleanup',
        run(ctx) {
          const pos = ctx.read(Position);
          const mover = ctx.read(Mover);
          for (const id of ctx.query([Position, Mover])) {
            const cx = Math.floor(pos.x[id] ?? 0);
            const cy = Math.floor(pos.y[id] ?? 0);
            if (!terrain.passable(cx, cy, mover.cls[id] ?? 0)) {
              throw new Error(`entity ${id} in impassable cell ${cx},${cy}`);
            }
            const prev = prevCell.get(id);
            const cell = cy * grid.width + cx;
            if (prev !== undefined && prev !== cell) {
              const pcx = prev % grid.width;
              const pcy = Math.floor(prev / grid.width);
              if (
                terrain.heightAt(pcx, pcy) !== terrain.heightAt(cx, cy) &&
                (grid.ramps[prev] ?? 0) === 0 &&
                (grid.ramps[cell] ?? 0) === 0
              ) {
                throw new Error(`entity ${id} crossed a cliff ${pcx},${pcy} -> ${cx},${cy}`);
              }
            }
            prevCell.set(id, cell);
          }
        },
      });
    },
  };
  const config: SimConfig = {
    seed: 7,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [],
    grid: { width: grid.width, height: grid.height },
    rngStreams: [],
    controllers: [],
  };
  const sim = createSimulation(config, [pathing.module, movement, spawner]);
  return {
    sim,
    handles,
    terrain,
    pathingApi,
    goals,
    released,
    pos(i) {
      const probes = sim.probes();
      return {
        x: probes[`frontline_td:test.u${i}x`] ?? -1,
        y: probes[`frontline_td:test.u${i}y`] ?? -1,
      };
    },
    active(i) {
      return sim.probes()[`frontline_td:test.u${i}a`] ?? -1;
    },
    slot(i) {
      const probes = sim.probes();
      return {
        x: probes[`frontline_td:test.u${i}tx`] ?? -1,
        y: probes[`frontline_td:test.u${i}ty`] ?? -1,
      };
    },
  };
}

export function move(
  handles: readonly EntityHandle[],
  x: number,
  y: number,
  tick = 1,
  issuer = F1,
): CommandEnvelope {
  return { tick: toTick(tick), issuer, type: MoveCommand.type, payload: { units: handles, x, y } };
}

export function run(world: World, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    world.sim.step();
  }
}

export function rejections(world: World): string[] {
  return world.sim
    .snapshot(F1)
    .events.filter((e) => e.type === COMMAND_REJECTED.type)
    .map((e) => (e.payload as { reason: string }).reason);
}
