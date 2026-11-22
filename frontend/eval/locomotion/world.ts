import { toFactionId, toTick, type FactionId, type FactionRelation } from '../../src/core/index';
import { loadContent, type ResolvedUnit } from '../../src/content/index';
import {
  createCombatModule,
  unitParts as combatUnitParts,
} from '../../src/features/combat/sim/index';
import {
  createLogisticsModule,
  unitParts as logisticsUnitParts,
} from '../../src/features/logistics/sim/index';
import { createMovementModule, MoveCommand } from '../../src/features/movement/sim/index';
import { createPathingModule } from '../../src/features/pathing/sim/index';
import {
  SquadsChannel,
  SquadsCreate,
  SquadsOrder,
  type SquadsSnapshot,
} from '../../src/features/squads/protocol';
import { createSquadsModule } from '../../src/features/squads/sim/index';
import type { TerrainGrid } from '../../src/features/terrain/content';
import { createTerrainModule } from '../../src/features/terrain/sim/index';
import { createUnitsModule, type FactionStart } from '../../src/features/units/sim/index';
import { CONTROLLER_STREAM_ID, createSimulation, type SimModule } from '../../src/kernel/index';
import { createLocomotionProbe } from './probe';
import type { ScenarioRunOutput, StaticObstacleRect } from './types';

const SEED = 20261121;
export const F1 = toFactionId(1);
export const F2 = toFactionId(2);

export function requireUnit(id: string): ResolvedUnit {
  const unit = loadContent().units.byId(id);
  if (unit === undefined) {
    throw new Error(`missing content unit '${id}'`);
  }
  return unit;
}

export function makeGrid(width: number, height: number, fillChar: '.' | '#'): string[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => fillChar));
}

export function paintRect(
  charGrid: string[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ch: string,
): void {
  for (let y = y0; y <= y1; y++) {
    const row = charGrid[y];
    if (row === undefined) {
      continue;
    }
    for (let x = x0; x <= x1; x++) {
      if (x >= 0 && x < row.length) {
        row[x] = ch;
      }
    }
  }
}

export function encodeCharGrid(charGrid: string[][]): TerrainGrid {
  const db = loadContent();
  const ground = db.surfaces.byId('frontline_td:ground')?.index ?? 0;
  const rock = db.surfaces.byId('frontline_td:rock')?.index ?? 0;
  const deepWater = db.surfaces.byId('frontline_td:deep_water')?.index ?? 0;
  const height = charGrid.length;
  const width = charGrid[0]?.length ?? 0;
  const surfaces = new Uint16Array(width * height).fill(ground);
  for (let y = 0; y < height; y++) {
    const row = charGrid[y];
    if (row === undefined) {
      continue;
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const idx = y * width + x;
      if (ch === '#') {
        surfaces[idx] = rock;
      } else if (ch === '~') {
        surfaces[idx] = deepWater;
      } else {
        surfaces[idx] = ground;
      }
    }
  }
  return {
    width,
    height,
    heights: new Uint8Array(width * height),
    surfaces,
    ramps: new Uint8Array(width * height),
  };
}

interface WorldSetup {
  readonly grid: TerrainGrid;
  readonly factions: FactionId[];
  readonly relations: { a: FactionId; b: FactionId; relation: FactionRelation }[];
  readonly starts: readonly FactionStart[];
  readonly ticks: number;
  readonly extraModules?: (
    terrain: ReturnType<typeof createTerrainModule>['api'],
    probe: ReturnType<typeof createLocomotionProbe>,
  ) => SimModule[];
}

export function createScenarioSim(setup: WorldSetup) {
  const db = loadContent();
  const terrain = createTerrainModule(setup.grid, [...db.surfaces.list]);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  const logistics = createLogisticsModule(db, terrain.api, { starts: setup.starts });
  terrain.api.onBlockedChange((cells, blocked) => {
    logistics.blockersChanged(cells, blocked);
  });
  const units = createUnitsModule(db, terrain.api, setup.starts, [
    logisticsUnitParts,
    combatUnitParts,
  ]);
  const combat = createCombatModule();
  const energyCargo = db.cargos.byId('frontline_td:energy')?.index ?? 0;
  const squads = createSquadsModule({
    db,
    terrain: terrain.api,
    pathing: pathing.api,
    logistics,
    combat,
    energyCargo,
  });
  const probe = createLocomotionProbe(terrain.api, setup.ticks);
  const extras = setup.extraModules?.(terrain.api, probe) ?? [];
  const modules: SimModule[] = [
    terrain.module,
    pathing.module,
    movement,
    logistics,
    units,
    combat,
    squads,
    ...extras,
    probe.module,
  ];
  const sim = createSimulation(
    {
      seed: SEED,
      factions: setup.factions.map((id) => ({ id })),
      relations: setup.relations,
      grid: { width: setup.grid.width, height: setup.grid.height },
      rngStreams: [{ id: CONTROLLER_STREAM_ID, purpose: 'eval locomotion' }],
      controllers: [],
    },
    modules,
  );
  return { db, sim, terrain: terrain.api, pathing: pathing.api, probe };
}

export function runMoveScenario(params: {
  grid: TerrainGrid;
  starts: readonly FactionStart[];
  goal: { x: number; y: number };
  ticks: number;
}): ScenarioRunOutput {
  const t0 = performance.now();
  const { sim, terrain, pathing, probe } = createScenarioSim({
    grid: params.grid,
    factions: [F1],
    relations: [],
    starts: params.starts,
    ticks: params.ticks,
  });
  sim.step();
  const initUnits = probe.initialUnits();
  const unitGoals = new Map<number, { x: number; y: number }>();
  for (const u of initUnits) {
    unitGoals.set(u.handle, params.goal);
  }
  sim.submit({
    tick: toTick(2),
    issuer: F1,
    type: MoveCommand.type,
    payload: { units: initUnits.map((u) => u.handle), x: params.goal.x, y: params.goal.y },
  });
  while ((sim.tick as number) < params.ticks) {
    sim.step();
  }
  return {
    grid: params.grid,
    terrain,
    pathing,
    recording: probe.finalize(),
    unitGoals,
    structures: [],
    hash: sim.hash(),
    simMs: performance.now() - t0,
  };
}

export function runSquadScenario(params: {
  grid: TerrainGrid;
  factions: FactionId[];
  relations: { a: FactionId; b: FactionId; relation: FactionRelation }[];
  starts: readonly FactionStart[];
  goal: { x: number; y: number };
  ticks: number;
  structures?: readonly StaticObstacleRect[];
  extraModules?: WorldSetup['extraModules'];
}): ScenarioRunOutput {
  const t0 = performance.now();
  const { db, sim, terrain, pathing, probe } = createScenarioSim({
    grid: params.grid,
    factions: params.factions,
    relations: params.relations,
    starts: params.starts,
    ticks: params.ticks,
    ...(params.extraModules !== undefined ? { extraModules: params.extraModules } : {}),
  });
  const robotRange = db.units.byId('frontline_td:robot')?.weapon?.range ?? 0;

  sim.step();
  const initUnits = probe.initialUnits().filter((u) => u.faction === 1);
  const unitGoals = new Map<number, { x: number; y: number }>();
  for (const u of initUnits) {
    probe.setGroup(u.handle, 1);
    probe.setRange(u.handle, u.radius > 0.45 ? 2 : robotRange);
    unitGoals.set(u.handle, params.goal);
  }

  sim.submit({
    tick: toTick(2),
    issuer: F1,
    type: SquadsCreate.type,
    payload: { units: initUnits.map((u) => u.handle), tag: 'eval:1' },
  });
  sim.step();
  sim.step();

  const snap = sim.snapshot(F1).channels[SquadsChannel.id] as SquadsSnapshot | undefined;
  const sq = snap?.squads.find((s) => s.tag === 'eval:1');
  if (sq === undefined) {
    throw new Error('eval locomotion: failed to create squad');
  }

  sim.submit({
    tick: toTick(4),
    issuer: F1,
    type: SquadsOrder.type,
    payload: { squad: sq.id, kind: 'advance', x: params.goal.x, y: params.goal.y },
  });

  while ((sim.tick as number) < params.ticks) {
    sim.step();
  }
  const simMs = performance.now() - t0;
  return {
    grid: params.grid,
    terrain,
    pathing,
    recording: probe.finalize(),
    unitGoals,
    structures: params.structures ?? [],
    hash: sim.hash(),
    simMs,
  };
}
