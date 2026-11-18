// Squads test harness: a world wired like sim-registry but built from
// public sim/index exports only (depcruise R4 forbids cross-feature
// test helpers).
import { contentId, toFactionId, toTick } from '../../../core/index';
import type { CommandEnvelope, EntityHandle, Serializable } from '../../../core/index';
import { loadContent } from '../../../content/index';
import type { ResolvedStructure, ResolvedSurface, ResolvedUnit } from '../../../content/index';
import { Faction, InWorld } from '../../../kernel/index';
import { createSimulation } from '../../../kernel/index';
import type { SimConfig, SimModule, SpawnInit } from '../../../kernel/index';
import { createCombatModule, unitParts as combatUnitParts } from '../../combat/sim/index';
import { structureParts as combatStructureParts } from '../../combat/sim/index';
import { Health } from '../../combat/sim/index';
import { createConstructionModule, Structure } from '../../construction/sim/index';
import {
  createLogisticsModule,
  structureParts as logisticsStructureParts,
  unitParts as logisticsUnitParts,
} from '../../logistics/sim/index';
import {
  createMovementModule,
  moverComponents,
  MoveTarget,
  Position,
} from '../../movement/sim/index';
import { createPathingModule } from '../../pathing/sim/index';
import {
  createProductionModule,
  structureParts as productionStructureParts,
} from '../../production/sim/index';
import { createTerrainModule } from '../../terrain/sim/index';
import { createUnitsModule } from '../../units/sim/index';
import type { FactionStart } from '../../units/sim/index';
import { SquadsChannel } from '../protocol';
import type { SquadsSnapshot } from '../protocol';
import { createSquadsModule } from './module';
import { makeGrid, must } from '../../../testing/index';

const F1 = toFactionId(1);
export const F2 = toFactionId(2);
const DB = loadContent();
const ENERGY = DB.cargos.byId('frontline_td:energy')?.index ?? -1;
const CLS = DB.movementClasses.byId('frontline_td:ground')?.index ?? 0;
export const ROBOT = must(DB.units.byId('frontline_td:robot'), 'robot');
export const BASE = must(DB.structures.byId('frontline_td:main_base'), 'main_base');
export const DEPOT = must(DB.structures.byId('frontline_td:supply_depot'), 'supply_depot');

const W = 30;
const H = 20;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

export type PartPatch = (comp: unknown, init: Record<string, number>) => Record<string, number>;

export function robotInit(unit: ResolvedUnit, x: number, y: number, patch?: PartPatch): SpawnInit {
  const parts: SpawnInit = [
    ...moverComponents(x + 0.5, y + 0.5, unit.cellsPerTick, unit.radius, CLS),
    ...logisticsUnitParts(unit),
    ...combatUnitParts(unit),
  ];
  if (patch === undefined) {
    return parts;
  }
  return parts.map(([comp, init]) => [
    comp,
    patch(comp, { ...(init ?? {}) } as Record<string, number>),
  ]);
}

export function structureInit(
  kind: ResolvedStructure,
  x: number,
  y: number,
  patch?: PartPatch,
): SpawnInit {
  const parts: SpawnInit = [
    [Structure, { kind: kind.index, x, y }],
    ...logisticsStructureParts(kind, x, y, 'complete', 0),
    ...productionStructureParts(kind),
    ...combatStructureParts(kind),
  ];
  if (patch === undefined) {
    return parts;
  }
  return parts.map(([comp, init]) => [
    comp,
    patch(comp, { ...(init ?? {}) } as Record<string, number>),
  ]);
}

interface Ent {
  parts: SpawnInit;
  faction?: number;
}

// A blocking structure placed mid-run: spawns complete and blocks its
// footprint like construction's real placement path does.
interface Wall {
  tick: number;
  kind: ResolvedStructure;
  x: number;
  y: number;
  faction?: number;
}

export interface Opts {
  entities?: readonly Ent[];
  factions?: readonly number[];
  withUnits?: boolean;
  extraModules?: readonly SimModule[];
  starts?: readonly FactionStart[];
  rows?: readonly string[];
  walls?: readonly Wall[];
}

export interface World {
  sim: ReturnType<typeof createSimulation>;
  config: SimConfig;
  modules: SimModule[];
  handles: EntityHandle[];
  issue(type: string, payload: Serializable, issuer?: typeof F1): void;
  hp(i: number): number;
  pos(i: number): { x: number; y: number };
  // hp of the i-th Structure+Health entity in id order, -1 when none.
  structHp(i: number): number;
  tgtGoal(i: number): number;
  tgtSlot(i: number): number;
}

export function world(opts: Opts): World {
  const grid = makeGrid([...(opts.rows ?? FLAT)]);
  const terrain = createTerrainModule(grid, SURFACES);
  const pathing = createPathingModule(terrain.api, 1);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  const logistics = createLogisticsModule(DB, terrain.api, { starts: opts.starts ?? [] });
  terrain.api.onBlockedChange((cells, blocked) => {
    logistics.blockersChanged(cells, blocked);
  });
  const construction = createConstructionModule(DB, terrain.api, logistics, {
    structureParts: [logisticsStructureParts, productionStructureParts, combatStructureParts],
    starts: opts.starts ?? [],
  });
  const production = createProductionModule(DB);
  const combat = createCombatModule();
  const units =
    opts.withUnits === true
      ? createUnitsModule(DB, terrain.api, opts.starts ?? [], [logisticsUnitParts, combatUnitParts])
      : null;
  const squads = createSquadsModule({
    db: DB,
    terrain: terrain.api,
    pathing: pathing.api,
    logistics,
    combat,
    energyCargo: ENERGY,
  });

  const handles: EntityHandle[] = [];
  const spawner: SimModule = {
    id: 'frontline_td:test.spawn',
    install(builder) {
      builder.onStart((ctx) => {
        for (const ent of opts.entities ?? []) {
          handles.push(ctx.spawn([[Faction, { id: ent.faction ?? 1 }], [InWorld], ...ent.parts]));
        }
      });
      (opts.entities ?? []).forEach((_, i) => {
        builder.probe(`frontline_td:test.hp${i}`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null || !ctx.has(Health, id) ? -1 : (ctx.read(Health).hp[id] ?? -1);
        });
        builder.probe(`frontline_td:test.x${i}`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(Position).x[id] ?? -1);
        });
        builder.probe(`frontline_td:test.y${i}`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(Position).y[id] ?? -1);
        });
        // MoveTarget goal id + slot cell — a re-emitted move reshuffles
        // these, so stable values prove no move intent fired.
        builder.probe(`frontline_td:test.tg${i}`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          return id === null ? -1 : (ctx.read(MoveTarget).goal[id] ?? -1);
        });
        builder.probe(`frontline_td:test.ts${i}`, (ctx) => {
          const id = ctx.resolve(handles[i] ?? (0 as EntityHandle));
          if (id === null) {
            return -1;
          }
          const t = ctx.read(MoveTarget);
          return Math.round((t.x[id] ?? -1) * 32) * 4096 + Math.round((t.y[id] ?? -1) * 32);
        });
      });
      // hp of the i-th structure in id order (walls, bases, depots).
      for (let i = 0; i < 8; i++) {
        builder.probe(`frontline_td:test.struct${i}`, (ctx) => {
          const list = ctx.query([Structure, InWorld, Health]).sort((a, b) => a - b);
          const id = list[i];
          return id === undefined ? -1 : (ctx.read(Health).hp[id] ?? -1);
        });
      }
      // Mid-run blocking walls: spawn complete and block the footprint,
      // mirroring spawnStructure's immediate setBlocked.
      builder.system({
        id: 'frontline_td:test.walls',
        phase: 'command',
        run(ctx) {
          for (const wall of opts.walls ?? []) {
            if (ctx.tick !== wall.tick) {
              continue;
            }
            ctx.spawn([
              [Faction, { id: wall.faction ?? 2 }],
              [InWorld],
              ...structureInit(wall.kind, wall.x, wall.y),
            ]);
            const cells: { x: number; y: number }[] = [];
            for (let dy = 0; dy < wall.kind.footprint.h; dy++) {
              for (let dx = 0; dx < wall.kind.footprint.w; dx++) {
                cells.push({ x: wall.x + dx, y: wall.y + dy });
              }
            }
            terrain.api.setBlocked(cells, true);
          }
        },
      });
    },
  };

  const factions = (opts.factions ?? [1]).map((f) => ({ id: toFactionId(f) }));
  const relations =
    factions.length >= 2
      ? [
          {
            a: factions[0]?.id ?? F1,
            b: factions[1]?.id ?? F2,
            relation: 'hostile' as const,
          },
        ]
      : [];
  const config: SimConfig = {
    seed: 7,
    factions,
    relations,
    grid: { width: grid.width, height: grid.height },
    rngStreams: [],
    controllers: [],
  };
  const modules: SimModule[] = [
    terrain.module,
    pathing.module,
    movement,
    logistics,
    construction,
    production,
    combat,
    ...(units === null ? [] : [units]),
    squads,
    spawner,
    ...(opts.extraModules ?? []),
  ];
  const sim = createSimulation(config, modules);
  return {
    sim,
    config,
    modules,
    handles,
    issue(type, payload, issuer = F1) {
      const env: CommandEnvelope = {
        tick: toTick(sim.tick + 1),
        issuer,
        type,
        payload,
      };
      sim.submit(env);
    },
    hp(i) {
      return sim.probes()[`frontline_td:test.hp${i}`] ?? -1;
    },
    pos(i) {
      const probes = sim.probes();
      return {
        x: probes[`frontline_td:test.x${i}`] ?? -1,
        y: probes[`frontline_td:test.y${i}`] ?? -1,
      };
    },
    structHp(i) {
      return sim.probes()[`frontline_td:test.struct${i}`] ?? -1;
    },
    tgtGoal(i) {
      return sim.probes()[`frontline_td:test.tg${i}`] ?? -1;
    },
    tgtSlot(i) {
      return sim.probes()[`frontline_td:test.ts${i}`] ?? -1;
    },
  };
}

export function run(w: World, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    w.sim.step();
  }
}

export function snapshot(w: World): SquadsSnapshot {
  return w.sim.snapshot(F1).channels[SquadsChannel.id] as SquadsSnapshot;
}

export function squad(w: World, id = 1) {
  return snapshot(w).squads.find((s) => s.id === id);
}

export const robots = (n: number, x: number, y: number, faction = 1) =>
  Array.from({ length: n }, (_, i) => ({
    parts: robotInit(ROBOT, x + i, y),
    faction,
  }));

export const createAll = (w: World, strength?: number) => {
  w.issue('frontline_td:squads.create', {
    units: w.handles.map((h) => Number(h)),
    ...(strength !== undefined ? { strength } : {}),
  });
};
