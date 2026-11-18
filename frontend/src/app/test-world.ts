// Shared helpers for the assault scenario tests: a real resolveSetup
// match on proto_01 plus channel accessors. Test code only.
import { loadContent } from '../content/index';
import { toFactionId } from '../core/index';
import type { Simulation } from '../kernel/index';
import { SquadsChannel } from '../features/squads/protocol';
import type { SquadsSnapshot } from '../features/squads/protocol';
import { StructuresChannel } from '../features/construction/protocol';
import type { ConstructionStructures } from '../features/construction/protocol';
import type { DenseUnits } from '../features/units/protocol';
import { defaultSetup } from '../modes/assault/index';
import { resolveSetup } from './resolve-setup';
import { denseUnits } from '../testing/index';

export const F2 = toFactionId(2);
export const DB = loadContent();
export const TPS = 20;

export function resolved(seed = 5) {
  const r = resolveSetup(defaultSetup(seed));
  if ('error' in r) {
    throw new Error(r.error);
  }
  return r;
}

export function run(sim: Simulation, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    sim.step();
  }
}

export function squads(sim: Simulation): SquadsSnapshot {
  return sim.snapshot(F2).channels[SquadsChannel.id] as SquadsSnapshot;
}

export function dense(sim: Simulation): DenseUnits {
  return denseUnits(sim, F2);
}

export function structures(sim: Simulation): ConstructionStructures {
  return sim.snapshot(F2).channels[StructuresChannel.id] as ConstructionStructures;
}
