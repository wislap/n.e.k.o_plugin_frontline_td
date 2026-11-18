// Capture tug-of-war tests (M5 batch A): a bare world with only the
// capture module plus a spawner — ruins carry the Capture component
// (as construction's ruinParts would add) and movers stand inside or
// outside the outpost's capture radius.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import type { ResolvedStructure } from '../../../content/index';
import type { Serializable } from '../../../core/index';
import { toFactionId } from '../../../core/index';
import type { SimConfig, SimModule, SpawnInit } from '../../../kernel/index';
import { Faction, InWorld, createSimulation, restoreSimulation } from '../../../kernel/index';
import { moverComponents } from '../../movement/sim/index';
import { CaptureCompleted, CapturePointsChannel } from '../protocol';
import type { CapturePoints } from '../protocol';
import { Capture } from './components';
import { createCaptureModule } from './module';

const DB = loadContent();
const F1 = toFactionId(1);
const F2 = toFactionId(2);

function must<T>(v: T | undefined, name: string): T {
  if (v === undefined) {
    throw new Error(`base pack entry '${name}' missing`);
  }
  return v;
}
const OUTPOST: ResolvedStructure = must(DB.structures.byId('frontline_td:outpost'), 'outpost');
const CAPTURE = must(OUTPOST.capture, 'outpost.capture');

// Ruin at top-left (10,10): centre (11.5, 11.5), capture radius 4.
const RUIN_X = 10;
const RUIN_Y = 10;

function ruinInit(overrides: Record<string, number> = {}): SpawnInit {
  return [
    [InWorld],
    [
      Capture,
      {
        owner: 0,
        progress: 0,
        done: 0,
        kind: OUTPOST.index,
        x: RUIN_X,
        y: RUIN_Y,
        leader: 0,
        contested: 0,
        ...overrides,
      },
    ],
  ];
}

function moverInit(faction: number, x: number, y: number): SpawnInit {
  return [[Faction, { id: faction }], [InWorld], ...moverComponents(x, y, 0.125, 0.35, 0)];
}

function spawnAll(inits: SpawnInit[]): SimModule {
  return {
    id: 'frontline_td:test.capture_spawn',
    install(builder) {
      builder.onStart((ctx) => {
        for (const init of inits) {
          ctx.spawn(init);
        }
      });
    },
  };
}

function makeConfig(): SimConfig {
  return {
    seed: 11,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [{ a: F1, b: F2, relation: 'hostile' }],
    grid: { width: 40, height: 40 },
    rngStreams: [],
    controllers: [],
  };
}

// Fresh module instances per sim: module closures are single-install
// and must not be shared between the live and restored simulation.
function makeSim(inits: SpawnInit[]) {
  const config = makeConfig();
  return { config, sim: createSimulation(config, [createCaptureModule(DB), spawnAll(inits)]) };
}

function captureRows(sim: ReturnType<typeof createSimulation>): CapturePoints {
  return sim.snapshot(F1).channels[CapturePointsChannel.id] as CapturePoints;
}

function completedTicks(sim: ReturnType<typeof createSimulation>): number {
  return sim.snapshot(F1).events.filter((e) => e.type === CaptureCompleted.type).length;
}

const TOTAL = CAPTURE.ticks * 1313; // ticks * lnMilli(1+e)

describe('capture tug-of-war', () => {
  it('a lone unit captures in about capture.seconds', () => {
    const { sim } = makeSim([ruinInit(), moverInit(1, 11.5, 11.5)]);
    let completedAt = -1;
    for (let t = 0; t < CAPTURE.ticks + 80 && completedAt < 0; t++) {
      sim.step();
      if (completedTicks(sim) > 0) {
        completedAt = sim.tick;
      }
    }
    expect(completedAt).toBeGreaterThan(0);
    // ln(1+e) per tick -> completion right at the tick budget.
    expect(completedAt).toBeGreaterThanOrEqual(CAPTURE.ticks);
    expect(completedAt).toBeLessThanOrEqual(CAPTURE.ticks + 3);
    const payload = sim
      .snapshot(F1)
      .events.filter((e) => e.type === CaptureCompleted.type)
      .map((e) => e.payload as { faction: number })[0];
    // The event sits on the completing tick's snapshot; the channel row
    // is already gone (done ruins are skipped).
    if (completedAt === sim.tick) {
      expect(payload?.faction).toBe(1);
    }
    expect(captureRows(sim).handles.length).toBe(0);
  });

  it('drains enemy progress and flips owner at zero', () => {
    // Faction 1 holds half progress; two faction-2 units stand on the
    // ruin with nobody else present.
    const { sim } = makeSim([
      ruinInit({ owner: 1, progress: Math.floor(TOTAL / 2) }),
      moverInit(2, 10.5, 11.5),
      moverInit(2, 12.5, 11.5),
    ]);
    // Two units: rate = lnMilli(2+e) per tick (~1551 milli).
    const drainTicks = Math.ceil(TOTAL / 2 / 1551);
    let flipped = false;
    for (let t = 0; t < drainTicks + 40 && !flipped; t++) {
      sim.step();
      const rows = captureRows(sim);
      if ((rows.owner[0] ?? 0) === 2) {
        flipped = true;
      }
    }
    expect(flipped).toBe(true);
    const rows = captureRows(sim);
    expect(rows.leader[0]).toBe(2);
    expect(rows.contested[0]).toBe(0);
  });

  it('decays 2%/s on an empty zone and clears owner at zero', () => {
    const progress0 = Math.floor(TOTAL / 10);
    const { sim } = makeSim([ruinInit({ owner: 1, progress: progress0 })]);
    sim.step();
    const after1 = captureRows(sim);
    // floor(total / 1000) per tick.
    expect(after1.progressBp[0]).toBeLessThan(
      Math.min(10000, Math.floor((progress0 * 10000) / TOTAL)),
    );
    const emptyTicks = Math.ceil(progress0 / Math.floor(TOTAL / 1000));
    for (let t = 0; t < emptyTicks + 40; t++) {
      sim.step();
    }
    const rows = captureRows(sim);
    expect(rows.progressBp[0]).toBe(0);
    expect(rows.owner[0]).toBe(0);
  });

  it('ties stall: equal top rates freeze progress and flag contested', () => {
    const progress0 = Math.floor(TOTAL / 4);
    const { sim } = makeSim([
      ruinInit({ owner: 1, progress: progress0 }),
      moverInit(1, 10.5, 11.5),
      moverInit(2, 12.5, 11.5),
    ]);
    for (let t = 0; t < 40; t++) {
      sim.step();
    }
    const rows = captureRows(sim);
    expect(rows.progressBp[0]).toBe(Math.min(10000, Math.floor((progress0 * 10000) / TOTAL)));
    expect(rows.owner[0]).toBe(1);
    expect(rows.contested[0]).toBe(1);
    expect(rows.leader[0]).toBe(0);
  });

  it('units outside the radius do not count', () => {
    const { sim } = makeSim([ruinInit(), moverInit(1, 30, 30)]);
    for (let t = 0; t < 20; t++) {
      sim.step();
    }
    const rows = captureRows(sim);
    expect(rows.progressBp[0]).toBe(0);
    expect(rows.owner[0]).toBe(0);
  });

  it('more units capture faster than fewer', () => {
    const { sim } = makeSim([
      ruinInit(),
      moverInit(1, 10.5, 11.5),
      moverInit(1, 12.5, 11.5),
      moverInit(1, 11.5, 10.5),
    ]);
    for (let t = 0; t < 20; t++) {
      sim.step();
    }
    const rows = captureRows(sim);
    // 3 units: rate lnMilli(3+e) ~= 1748 > 1313 per tick.
    expect(rows.progressBp[0]).toBeGreaterThan(Math.floor((20 * 1313 * 10000) / TOTAL));
    expect(rows.leader[0]).toBe(1);
  });

  it('progress, owner and done survive save/restore', () => {
    const { config, sim: simA } = makeSim([
      ruinInit(),
      moverInit(1, 11.5, 11.5),
      moverInit(2, 30, 30),
    ]);
    let save: Serializable | null = null;
    for (let t = 0; t < 200; t++) {
      simA.step();
      if (t === 120) {
        save = simA.serialize();
      }
    }
    const simB = restoreSimulation(config, [createCaptureModule(DB), spawnAll([])], save ?? {});
    while (simB.tick < simA.tick) {
      simB.step();
    }
    expect(simB.hash()).toBe(simA.hash());
    expect(captureRows(simB).progressBp[0]).toBe(captureRows(simA).progressBp[0]);
  });
});
