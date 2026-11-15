import { toFactionId } from '../../core/index';
import type { FactionId } from '../../core/index';
import { CONTROLLER_STREAM_ID } from '../internals';
import type { SimConfig } from '../types';
import { EXERCISE_RNG } from './exercise';

export const F1: FactionId = toFactionId(1);
export const F2: FactionId = toFactionId(2);
export const F3: FactionId = toFactionId(3);

export function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: 42,
    factions: [{ id: F1 }, { id: F2 }],
    relations: [],
    grid: { width: 4, height: 4 },
    rngStreams: [
      { id: EXERCISE_RNG, purpose: 'exercise test module' },
      { id: CONTROLLER_STREAM_ID, purpose: 'controller decisions' },
    ],
    controllers: [],
    ...overrides,
  };
}
