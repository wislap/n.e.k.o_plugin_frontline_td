// Perf scenario (ADR 0024): deterministic 256x256 map (open ground with
// scattered rock blobs and forest), N units of one faction spread over the
// map, groups re-targeted to random passable cells every 100 ticks, 1200
// ticks through runScenario. Reports per-system and per-tick avg/p95/max ms,
// ticks/s and heap usage; compares against eval/baselines/perf-movement.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { memoryUsage, version as nodeVersion } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../../src/content/index';
import type { ResolvedSurface } from '../../src/content/index';
import {
  createRngState,
  packHandle,
  rngNextIntBelow,
  toFactionId,
  toTick,
} from '../../src/core/index';
import type { CommandEnvelope, RngState } from '../../src/core/index';
import { createMovementModule, MoveCommand } from '../../src/features/movement/sim/index';
import { createPathingModule } from '../../src/features/pathing/sim/index';
import { createTerrainModule } from '../../src/features/terrain/sim/index';
import type { TerrainGrid } from '../../src/features/terrain/content';
import { createUnitsModule } from '../../src/features/units/sim/index';
import type { StartUnit } from '../../src/features/units/sim/index';
import { runScenario } from '../../src/kernel/index';
import type { Simulation } from '../../src/kernel/index';

const EVAL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIO = 'perf-movement';
const TICKS = 1200;
const RETARGET_EVERY = 100;
const MAP_SIZE = 256;
const SEED = 20261114;
const FACTION = toFactionId(1);

interface Stats {
  avg: number;
  p95: number;
  max: number;
}

interface Report {
  scenario: string;
  n: number;
  ticks: number;
  seed: number;
  hash: string;
  machine: { platform: string; arch: string; node: string };
  tick: Stats;
  // Per-tick totals on the ticks retarget commands apply (slot generation
  // + matching runs inside the move command handler).
  retargetTick: Stats;
  ticksPerSecond: number;
  heapUsedBytes: number;
  systems: Record<string, Stats>;
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

// Deterministic terrain: ground with rock blobs and forest patches. Indices
// come from the content db so the surface registry stays the source of truth.
function makeMap(rng: RngState): { grid: TerrainGrid; passable: number[] } {
  const db = loadContent();
  const ground = db.surfaces.byId('frontline_td:ground')?.index ?? 0;
  const forest = db.surfaces.byId('frontline_td:forest')?.index ?? 0;
  const rock = db.surfaces.byId('frontline_td:rock')?.index ?? 0;
  const surfaces = new Uint16Array(MAP_SIZE * MAP_SIZE).fill(ground);
  for (let b = 0; b < 40; b++) {
    const cx = rngNextIntBelow(rng, MAP_SIZE);
    const cy = rngNextIntBelow(rng, MAP_SIZE);
    const r = 2 + rngNextIntBelow(rng, 7);
    const kind = rngNextIntBelow(rng, 2) === 0 ? rock : forest;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) {
          continue;
        }
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) {
          surfaces[y * MAP_SIZE + x] = kind;
        }
      }
    }
  }
  const passable: number[] = [];
  const groundIndex = ground;
  const forestIndex = forest;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    if (s === groundIndex || s === forestIndex) {
      passable.push(i);
    }
  }
  return {
    grid: {
      width: MAP_SIZE,
      height: MAP_SIZE,
      heights: new Uint8Array(MAP_SIZE * MAP_SIZE),
      surfaces,
      ramps: new Uint8Array(MAP_SIZE * MAP_SIZE),
    },
    passable,
  };
}

export function main(args: string[]): void {
  const updateBaseline = args.includes('--update-baseline');
  const nArg = args.find((a) => /^\d+$/.test(a));
  const n = nArg !== undefined ? Number(nArg) : 5000;

  const db = loadContent();
  const surfaces: ResolvedSurface[] = [...db.surfaces.list];
  const robot = db.units.byIndex(0);
  if (robot === undefined) {
    throw new Error('base pack has no units');
  }
  const rng = createRngState(SEED, 'eval:map');
  const { grid, passable } = makeMap(rng);

  // Spread N units across the map: ceil(N/64) groups at rng-picked cells.
  const groups: StartUnit[] = [];
  let remaining = n;
  while (remaining > 0) {
    const cell = passable[rngNextIntBelow(rng, passable.length)] ?? 0;
    const count = Math.min(64, remaining);
    groups.push({ kind: robot.index, x: cell % MAP_SIZE, y: Math.floor(cell / MAP_SIZE), count });
    remaining -= count;
  }

  const terrain = createTerrainModule(grid, surfaces);
  const pathing = createPathingModule(terrain.api, db.movementClasses.list.length);
  const movement = createMovementModule(terrain.api, pathing.api);
  const units = createUnitsModule(db, terrain.api, [{ faction: FACTION, units: groups }]);
  const modules = [terrain.module, pathing.module, movement, units];

  // Retarget a rotating chunk of units every RETARGET_EVERY ticks. Handles
  // are deterministic: start-state ids are 1..N with generation 0.
  const commands: CommandEnvelope[] = [];
  const commandRng = createRngState(SEED, 'eval:commands');
  for (let tick = RETARGET_EVERY; tick < TICKS; tick += RETARGET_EVERY) {
    const chunk = Math.min(200, n);
    const base = rngNextIntBelow(commandRng, n);
    const handles: number[] = [];
    for (let k = 0; k < chunk; k++) {
      handles.push(packHandle(1 + ((base + k) % n), 0));
    }
    const cell = passable[rngNextIntBelow(commandRng, passable.length)] ?? 0;
    commands.push({
      tick: toTick(tick),
      issuer: FACTION,
      type: MoveCommand.type,
      payload: { units: handles, x: cell % MAP_SIZE, y: Math.floor(cell / MAP_SIZE) },
    });
  }

  // Per-tick per-system timing via the onTick diff hook.
  const tickMs: number[] = [];
  const retargetTickMs: number[] = [];
  const systemMs = new Map<string, number[]>();
  let prevTimings: Record<string, { count: number; total: number }> = {};
  const wallStart = performance.now();
  const result = runScenario({
    config: {
      seed: SEED,
      factions: [{ id: FACTION }],
      relations: [],
      grid: { width: MAP_SIZE, height: MAP_SIZE },
      rngStreams: [],
      controllers: [],
      timer: () => performance.now(),
    },
    modules,
    commands,
    ticks: TICKS,
    onTick: (sim: Simulation) => {
      const now = sim.timings();
      let total = 0;
      for (const [id, rec] of Object.entries(now)) {
        const prev = prevTimings[id]?.total ?? 0;
        const delta = rec.total - prev;
        if (delta > 0) {
          total += delta;
          let list = systemMs.get(id);
          if (list === undefined) {
            list = [];
            systemMs.set(id, list);
          }
          while (list.length < tickMs.length) {
            list.push(0);
          }
          list.push(delta);
        }
      }
      for (const [id, list] of systemMs) {
        if (!Object.hasOwn(now, id)) {
          continue;
        }
        while (list.length < tickMs.length) {
          list.push(0);
        }
      }
      prevTimings = now;
      tickMs.push(total);
      // Commands at tick T apply while stepping to T+1.
      if ((sim.tick as number) % RETARGET_EVERY <= 1) {
        retargetTickMs.push(total);
      }
    },
  });
  const wallMs = performance.now() - wallStart;
  const heap = memoryUsage().heapUsed;

  const systems: Record<string, Stats> = {};
  for (const [id, list] of systemMs) {
    while (list.length < tickMs.length) {
      list.push(0);
    }
    systems[id] = stats(list);
  }
  const report: Report = {
    scenario: SCENARIO,
    n,
    ticks: TICKS,
    seed: SEED,
    hash: result.hash,
    machine: { platform: platform(), arch: arch(), node: nodeVersion },
    tick: stats(tickMs),
    retargetTick: stats(retargetTickMs),
    ticksPerSecond: (TICKS * 1000) / wallMs,
    heapUsedBytes: heap,
    systems,
  };

  const top = Object.entries(systems)
    .sort((a, b) => b[1].avg - a[1].avg)
    .slice(0, 3);
  console.log(`scenario=${SCENARIO} n=${n} ticks=${TICKS} hash=${report.hash}`);
  console.log(
    `tick ms: avg=${report.tick.avg.toFixed(3)} p95=${report.tick.p95.toFixed(3)} max=${report.tick.max.toFixed(3)}`,
  );
  console.log(
    `ticks/s=${report.ticksPerSecond.toFixed(1)} heap=${(heap / 1048576).toFixed(1)} MiB`,
  );
  console.log(
    `retarget tick ms: avg=${report.retargetTick.avg.toFixed(3)} p95=${report.retargetTick.p95.toFixed(3)} max=${report.retargetTick.max.toFixed(3)}`,
  );
  for (const [id, s] of top) {
    console.log(`  ${id}: avg=${s.avg.toFixed(3)} p95=${s.p95.toFixed(3)} max=${s.max.toFixed(3)}`);
  }

  const reportsDir = path.join(EVAL_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `${SCENARIO}-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`report: ${reportPath}`);

  const baselinePath = path.join(EVAL_ROOT, 'baselines', `${SCENARIO}.json`);
  if (updateBaseline) {
    mkdirSync(path.dirname(baselinePath), { recursive: true });
    const baseline = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as {
          machine?: Report['machine'];
          runs?: Record<string, Report>;
        })
      : {};
    baseline.machine = report.machine;
    baseline.runs = { ...(baseline.runs ?? {}), [String(n)]: report };
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    console.log(`baseline updated: ${baselinePath}`);
  } else if (existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      runs?: Record<string, { tick: Stats; ticksPerSecond: number }>;
    };
    const ref = baseline.runs?.[String(n)];
    if (ref !== undefined) {
      const delta = ((report.tick.avg - ref.tick.avg) / Math.max(ref.tick.avg, 1e-9)) * 100;
      console.log(
        `baseline(n=${n}): avg=${ref.tick.avg.toFixed(3)}ms (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%), ` +
          `ticks/s=${ref.ticksPerSecond.toFixed(1)}`,
      );
    } else {
      console.log(`baseline: no entry for n=${n}`);
    }
  } else {
    console.log('baseline: none found (use --update-baseline to record one)');
  }
}
