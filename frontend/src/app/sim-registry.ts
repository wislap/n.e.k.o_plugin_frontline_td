// Module and RNG-stream registry assembled by the app (ADR 0019/0023). M1
// ships no feature modules; modes will contribute their own registries later.
import type { SimModule } from '../kernel/index';
import { CONTROLLER_STREAM_ID } from '../kernel/index';

export const SIM_MODULES: readonly SimModule[] = [];

export const RNG_STREAMS = [
  { id: CONTROLLER_STREAM_ID, purpose: 'per-faction controller decisions' },
] as const;
