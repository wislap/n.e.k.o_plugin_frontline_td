import { describe, expect, it } from 'vitest';
import { handleId } from '../core/index';
import type { CommandEnvelope, EntityHandle } from '../core/index';
import { restoreSimulation } from './simulation';
import { createSimulation } from './simulation';
import { runScenario } from './scenario';
import type { SimConfig } from './types';
import { CONTROLLER_STREAM_ID } from './internals';
import { baseConfig, F1, F2 } from './testing/helpers';
import {
  createExerciseController,
  createExerciseModule,
  exerciseCommand,
  DespawnCommand,
  EXERCISE_RNG,
  SpawnCommand,
  type ExerciseSink,
} from './testing/exercise';

function scenarioConfig(): SimConfig {
  return baseConfig({
    grid: { width: 8, height: 8 },
    rngStreams: [
      { id: EXERCISE_RNG, purpose: 'exercise module randomness' },
      { id: CONTROLLER_STREAM_ID, purpose: 'controller decisions' },
    ],
    controllers: [createExerciseController(F1, 7)],
  });
}

function scenarioCommands(): CommandEnvelope[] {
  return [
    exerciseCommand(3, F2, SpawnCommand, { count: 3 }),
    exerciseCommand(9, F1, SpawnCommand, { count: 4 }),
    // Deliberately stale handle: the handler rejects it via ctx.reject,
    // exercising the deterministic rejection path too.
    exerciseCommand(12, F2, DespawnCommand, { handle: 1 }),
    // A command still pending at the save tick K=30 below, so the
    // save/restore test covers the pending-command queue.
    exerciseCommand(35, F2, SpawnCommand, { count: 2 }),
  ];
}

const TICKS = 60;

describe('determinism (architecture §10)', () => {
  it('golden state hash after N ticks', () => {
    const sink: ExerciseSink = { spawnedIds: [], despawnedIds: [] };
    const result = runScenario({
      config: scenarioConfig(),
      modules: [createExerciseModule(sink)],
      commands: scenarioCommands(),
      ticks: TICKS,
    });
    // Golden hash: update this literal only for intentional state changes.
    expect(result.hash).toBe('d1202752d6fb108f');
  });

  it('same scenario twice produces identical hash and command log', () => {
    const run = () =>
      runScenario({
        config: scenarioConfig(),
        modules: [createExerciseModule()],
        commands: scenarioCommands(),
        ticks: TICKS,
      });
    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.commandLog).toEqual(b.commandLog);
  });

  it('save at tick K, restore, continue to N: identical hash and a recycled id', () => {
    const K = 30;
    const sinkA: ExerciseSink = { spawnedIds: [], despawnedIds: [] };
    const moduleA = createExerciseModule(sinkA);
    const simA = createSimulation(scenarioConfig(), [moduleA]);
    // All scripted commands go in up front; the pending queue (serialized in
    // the save) carries the ones due after the save tick.
    for (const env of scenarioCommands()) {
      simA.submit(env);
    }
    let save: ReturnType<typeof simA.serialize> | null = null;
    for (let t = 0; t < TICKS; t++) {
      if (t === K) {
        save = simA.serialize();
      }
      simA.step();
    }
    expect(save).not.toBeNull();
    const saved = save as unknown as {
      scheduled: { queue: unknown[] };
      tickEvents: unknown[];
      commands: { pending: unknown[] };
    };
    // The save must be non-trivial: scheduled effects pending, at least one
    // not-yet-due command, and events from the last completed tick.
    expect(saved.scheduled.queue.length).toBeGreaterThan(0);
    expect(saved.commands.pending.length).toBeGreaterThan(0);
    expect(saved.tickEvents.length).toBeGreaterThan(0);

    const sinkB: ExerciseSink = { spawnedIds: [], despawnedIds: [] };
    const moduleB = createExerciseModule(sinkB);
    const simB = restoreSimulation(scenarioConfig(), [moduleB], save ?? {});
    for (let t = K; t < TICKS; t++) {
      simB.step();
    }
    expect(simB.tick).toBe(simA.tick);
    expect(simB.hash()).toBe(simA.hash());

    // At least one bitecs id must have been recycled during the run, so the
    // save/restore path actually exercised index reconstruction.
    const rawIds = sinkA.spawnedIds.map((h) => handleId(h as EntityHandle));
    expect(new Set(rawIds).size).toBeLessThan(rawIds.length);
  });
});
