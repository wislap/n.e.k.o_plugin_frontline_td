// Controller save/load: a controller's private state is serialized into
// the sim save keyed by faction, restored before the first step, and a
// save/restore mid-match reproduces the uninterrupted run's hash.
import { describe, expect, it } from 'vitest';
import type { Serializable } from '../core/index';
import { CONTROLLER_STREAM_ID } from './internals';
import { createSimulation, restoreSimulation } from './simulation';
import { SpawnCommand, createExerciseModule, EXERCISE_RNG } from './testing/exercise';
import { baseConfig, F1 } from './testing/helpers';
import type { Controller, SimConfig } from './types';

// Stateful test controller: issues one spawn every `period` decides,
// driven entirely by its own counter — no state outside save/load.
function createCountingController(period: number): Controller {
  let decides = 0;
  return {
    faction: F1,
    save() {
      return { decides };
    },
    load(data: Serializable) {
      decides = (data as { decides: number }).decides;
    },
    decide(input) {
      decides += 1;
      if (decides % period === 0) {
        input.issue(SpawnCommand.type, { count: 1 });
      }
    },
  };
}

function config(): SimConfig {
  return baseConfig({
    rngStreams: [
      { id: EXERCISE_RNG, purpose: 'exercise test module' },
      { id: CONTROLLER_STREAM_ID, purpose: 'controller decisions' },
    ],
    controllers: [createCountingController(5)],
  });
}

const TICKS = 40;
const SAVE_AT = 17;

describe('controller save/load', () => {
  it('controller state enters the save and survives restore with identical hash', () => {
    const simA = createSimulation(config(), [createExerciseModule()]);
    let save: ReturnType<typeof simA.serialize> | null = null;
    for (let t = 0; t < TICKS; t++) {
      if (t === SAVE_AT) {
        save = simA.serialize();
      }
      simA.step();
    }
    expect(save).not.toBeNull();
    const savedControllers = (
      save as unknown as { controllerStates: Record<string, { decides: number }> }
    ).controllerStates;
    expect(savedControllers[String(F1)]?.decides).toBe(SAVE_AT);

    const simB = restoreSimulation(config(), [createExerciseModule()], save ?? {});
    for (let t = SAVE_AT; t < TICKS; t++) {
      simB.step();
    }
    expect(simB.tick).toBe(simA.tick);
    expect(simB.hash()).toBe(simA.hash());
  });

  it('a controller without save/load restores cleanly too', () => {
    const bare = baseConfig({ controllers: [{ faction: F1, decide: () => undefined }] });
    const simA = createSimulation(bare, [createExerciseModule()]);
    for (let t = 0; t < 10; t++) {
      simA.step();
    }
    const simB = restoreSimulation(bare, [createExerciseModule()], simA.serialize());
    simA.step();
    simB.step();
    expect(simB.hash()).toBe(simA.hash());
  });
});
