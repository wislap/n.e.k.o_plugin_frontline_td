// Perf scenario (M3 E4): 256x256 open map, ~200 logistics nodes on a
// grid linked by auto-topology, ~3000 live consumers (static stores and
// battery movers) demanding energy, a fraction of link cells paved, and
// a few hostile interceptors sitting on links. Measures the
// 'frontline_td:logistics.allocate' system per cycle (mean/p95/max) and
// the one-off topology rebuild. Writes eval/baselines/perf-logistics.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { memoryUsage, version as nodeVersion } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../../src/content/index';
import { createRngState, rngNextIntBelow, toFactionId } from '../../src/core/index';
import { runScenario } from '../../src/kernel/index';
import type { SimModule, Simulation, SpawnInit } from '../../src/kernel/index';
import { Faction, InWorld } from '../../src/kernel/index';
import {
  createLogisticsModule,
  CARGO_SLOTS,
  CargoStore,
  EMPTY_CARGO,
  Interceptor,
  LogisticsNode,
} from '../../src/features/logistics/sim/index';
import {
  createMovementModule,
  moverComponents,
  Position,
} from '../../src/features/movement/sim/index';
import { createPathingModule } from '../../src/features/pathing/sim/index';
import { createTerrainModule } from '../../src/features/terrain/sim/index';
import type { TerrainGrid } from '../../src/features/terrain/content';

const EVAL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIO = 'perf-logistics';
const TICKS = 600;
const MAP_SIZE = 256;
const SEED = 20261114;
const NODE_COLS = 15;
const NODE_ROWS = 14;
const NODE_SPACING = 17;
const CONSUMERS = 2000;
const BATTERY_UNITS = 1000;
const INTERCEPTORS = 6;
const ALLOCATE_ID = 'frontline_td:logistics.allocate';

interface Stats {
  avg: number;
  p95: number;
  max: number;
}

interface Report {
  scenario: string;
  nodes: number;
  consumers: number;
  ticks: number;
  seed: number;
  hash: string;
  machine: { platform: string; arch: string; node: string };
  // Per-allocate-system ms across all ticks (0 on non-cycle ticks).
  cycle: Stats;
  // Cycle ticks only (where allocation actually ran).
  activeCycle: Stats;
  topoRebuildMs: number;
  heapUsedBytes: number;
}

interface SlotSpec {
  cargo: number;
  cap: number;
  amt?: number;
  cls: number;
  flags?: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    avg: total / Math.max(samples.length, 1),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// CargoStore spawn record from simple slot specs (milli amounts).
function storeInit(slots: readonly SlotSpec[]): Record<string, number> {
  const v: Record<string, number> = { bottleneck: 0 };
  for (let i = 0; i < CARGO_SLOTS; i++) {
    const s = slots[i];
    v[`cargo${i}`] = s === undefined ? EMPTY_CARGO : s.cargo;
    v[`cap${i}`] = s?.cap ?? 0;
    v[`amt${i}`] = s?.amt ?? 0;
    v[`cls${i}`] = s?.cls ?? 0;
    v[`flags${i}`] = s?.flags ?? 0;
    v[`since${i}`] = 0;
    v[`rate${i}`] = 0;
    v[`unmet${i}`] = 0;
  }
  return v;
}

function nodeParts(
  x: number,
  y: number,
  warehouse: boolean,
  stores: Record<string, number>,
): SpawnInit {
  return [
    [Position, { x: x + 0.5, y: y + 0.5 }],
    // connect is in cost units (10/cell): 400 reaches neighbours at the
    // 17-cell grid spacing, incl. near-diagonals.
    [
      LogisticsNode,
      { connect: 400, service: 12, vehicles: 8, warehouse: warehouse ? 1 : 0, w: 1, h: 1 },
    ],
    [CargoStore, stores],
  ];
}

export function main(): void {
  const db = loadContent();
  const energy = db.cargos.byId('frontline_td:energy')?.index ?? 0;
  const groundCls = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
  const ground = db.surfaces.byId('frontline_td:ground')?.index ?? 0;
  const cycleTicks = db.logistics.cycleTicks;
  const rng = createRngState(SEED, 'eval:layout');

  const grid: TerrainGrid = {
    width: MAP_SIZE,
    height: MAP_SIZE,
    heights: new Uint8Array(MAP_SIZE * MAP_SIZE),
    surfaces: new Uint16Array(MAP_SIZE * MAP_SIZE).fill(ground),
    ramps: new Uint8Array(MAP_SIZE * MAP_SIZE),
  };

  const entities: { parts: SpawnInit; faction: number }[] = [];

  // ~200 nodes on a grid linked by auto-topology.
  for (let r = 0; r < NODE_ROWS; r++) {
    for (let c = 0; c < NODE_COLS; c++) {
      const warehouse = r === 0 && c === 0;
      const stores = warehouse
        ? storeInit([{ cargo: energy, cap: 4_000_000_000, amt: 4_000_000_000, cls: 0, flags: 1 }])
        : storeInit([]);
      entities.push({
        parts: nodeParts(6 + c * NODE_SPACING, 6 + r * NODE_SPACING, warehouse, stores),
        faction: 1,
      });
    }
  }
  const nodeCount = entities.length;

  // Consumers scattered across the map with live energy demand.
  for (let i = 0; i < CONSUMERS; i++) {
    const x = rngNextIntBelow(rng, MAP_SIZE - 2) + 1;
    const y = rngNextIntBelow(rng, MAP_SIZE - 2) + 1;
    entities.push({
      parts: [
        [Position, { x: x + 0.5, y: y + 0.5 }],
        [CargoStore, storeInit([{ cargo: energy, cap: 2000, cls: 0 }])],
      ],
      faction: 1,
    });
  }
  // Battery units (movers with an energy store).
  for (let i = 0; i < BATTERY_UNITS; i++) {
    const x = rngNextIntBelow(rng, MAP_SIZE - 2) + 1;
    const y = rngNextIntBelow(rng, MAP_SIZE - 2) + 1;
    entities.push({
      parts: [
        ...moverComponents(x + 0.5, y + 0.5, 0.125, 0.35, groundCls),
        [CargoStore, storeInit([{ cargo: energy, cap: 4000, cls: 3 }])],
      ],
      faction: 1,
    });
  }
  // Hostile interceptors parked on mid-edge link corridors.
  for (let i = 0; i < INTERCEPTORS; i++) {
    const c = 3 + i * 2;
    entities.push({
      parts: [
        [Position, { x: 6 + c * NODE_SPACING + NODE_SPACING / 2, y: 6 + 6 * NODE_SPACING }],
        [Interceptor, { strengthBp: 5000 }],
      ],
      faction: 2,
    });
  }

  const terrain = createTerrainModule(grid, [...db.surfaces.list]);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  terrain.api.onBlockedChange((cells) => {
    pathing.api.invalidateCells(cells);
  });
  const movement = createMovementModule(terrain.api, pathing.api);
  const logistics = createLogisticsModule(db, terrain.api, {
    starts: [{ faction: toFactionId(1), stock: new Map([[energy, 4_000_000]]) }],
  });
  terrain.api.onBlockedChange((cells, blocked) => {
    logistics.blockersChanged(cells, blocked);
  });

  const spawner: SimModule = {
    id: 'frontline_td:eval.spawn',
    install(builder) {
      builder.onStart((ctx) => {
        for (const ent of entities) {
          ctx.spawn([[Faction, { id: ent.faction }], [InWorld], ...ent.parts]);
        }
      });
    },
  };
  const modules = [terrain.module, pathing.module, movement, logistics, spawner];

  // Pave a fraction of cells once the sim is installed (env exists then):
  // horizontal strips through the busy middle of the node grid.
  const paveCells: { x: number; y: number }[] = [];
  for (let r = 0; r < NODE_ROWS; r += 2) {
    for (let x = 4; x < 6 + NODE_COLS * NODE_SPACING; x++) {
      paveCells.push({ x, y: 6 + r * NODE_SPACING });
    }
  }
  let paved = false;

  const allocMs: number[] = [];
  const activeMs: number[] = [];
  let topoRebuildMs = 0;
  let prevAlloc = 0;
  const heapStart = memoryUsage().heapUsed;
  const result = runScenario({
    config: {
      seed: SEED,
      factions: [{ id: toFactionId(1) }, { id: toFactionId(2) }],
      relations: [{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }],
      grid: { width: MAP_SIZE, height: MAP_SIZE },
      rngStreams: [],
      controllers: [],
      timer: () => performance.now(),
    },
    modules,
    commands: [],
    ticks: TICKS,
    onTick: (sim: Simulation) => {
      if (!paved) {
        logistics.pave(paveCells, 1);
        paved = true;
      }
      const now = sim.timings()[ALLOCATE_ID]?.total ?? 0;
      const delta = now - prevAlloc;
      prevAlloc = now;
      allocMs.push(delta);
      const tick = sim.tick as number;
      if (tick % cycleTicks === 0 || delta > 0) {
        activeMs.push(delta);
        if (topoRebuildMs === 0) {
          topoRebuildMs = delta;
        }
      }
    },
  });
  const heap = memoryUsage().heapUsed - heapStart;

  const report: Report = {
    scenario: SCENARIO,
    nodes: nodeCount,
    consumers: CONSUMERS + BATTERY_UNITS,
    ticks: TICKS,
    seed: SEED,
    hash: result.hash,
    machine: { platform: platform(), arch: arch(), node: nodeVersion },
    cycle: stats(allocMs),
    activeCycle: stats(activeMs),
    topoRebuildMs,
    heapUsedBytes: heap,
  };
  console.log(
    `scenario=${SCENARIO} nodes=${nodeCount} consumers=${CONSUMERS + BATTERY_UNITS} ticks=${TICKS} hash=${report.hash}`,
  );
  console.log(
    `allocate ms: mean=${report.cycle.avg.toFixed(3)} p95=${report.cycle.p95.toFixed(3)} max=${report.cycle.max.toFixed(3)}`,
  );
  console.log(
    `active cycle ms: mean=${report.activeCycle.avg.toFixed(3)} p95=${report.activeCycle.p95.toFixed(3)} max=${report.activeCycle.max.toFixed(3)}`,
  );
  console.log(
    `topo rebuild ms=${topoRebuildMs.toFixed(3)} heap=${(heap / 1048576).toFixed(1)} MiB`,
  );

  const reportsDir = path.join(EVAL_ROOT, 'baselines');
  mkdirSync(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `${SCENARIO}.json`);
  if (existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, 'utf8')) as Report;
    console.log(
      `baseline: mean=${prev.cycle.avg.toFixed(3)} p95=${prev.cycle.p95.toFixed(3)} (kept on disk; update by deleting the file)`,
    );
    return;
  }
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}
