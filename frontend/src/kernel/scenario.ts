import type { CommandEnvelope, Tick } from '../core/index';
import { createSimulation } from './simulation';
import type { SimConfig, SimModule } from './types';

// Shared by tests and eval (ADR 0024): run a headless scenario to completion.
export interface ScenarioSpec {
  config: SimConfig;
  modules: readonly SimModule[];
  commands: readonly CommandEnvelope[];
  ticks: number;
  sampleEvery?: number;
}

export interface ScenarioResult {
  hash: string;
  tick: Tick;
  probes: Record<string, number>;
  samples: { tick: Tick; probes: Record<string, number> }[];
  timings: Record<string, { count: number; total: number }>;
  commandLog: CommandEnvelope[];
}

export function runScenario(spec: ScenarioSpec): ScenarioResult {
  const sim = createSimulation(spec.config, spec.modules);
  const samples: ScenarioResult['samples'] = [];
  // Submit the whole script up front, in order: the pending queue holds
  // future envelopes and invalid ones produce the usual rejections.
  for (const envelope of spec.commands) {
    sim.submit(envelope);
  }
  for (let step = 0; step < spec.ticks; step++) {
    sim.step();
    if (spec.sampleEvery !== undefined && (step + 1) % spec.sampleEvery === 0) {
      samples.push({ tick: sim.tick, probes: sim.probes() });
    }
  }
  return {
    hash: sim.hash(),
    tick: sim.tick,
    probes: sim.probes(),
    samples,
    timings: sim.timings(),
    commandLog: sim.commandLog(),
  };
}
