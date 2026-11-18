// Assault director scenario: mid-gather save/restore reproduces the
// uninterrupted run (director private state is part of the hash).
import { describe, expect, it } from 'vitest';
import { restoreSimulation } from '../kernel/index';
import { TPS, resolved, run } from './test-world';

describe('assault persistence', () => {
  it('restored mid-gather reproduces the uninterrupted run', () => {
    const a = resolved();
    const tps = TPS;
    run(a.sim, 100 * tps); // mid-gather: created at 90 s, launches ~150 s
    const saved = a.sim.serialize();
    const controllerStates = (saved as unknown as { controllerStates: Record<string, unknown> })
      .controllerStates;
    // The director's private state is part of the save (and the hash).
    expect(controllerStates[String(2)]).toBeDefined();
    // A second resolved instance supplies fresh modules for the restore.
    const b = resolved();
    const restored = restoreSimulation(b.config, b.modules, saved);
    run(a.sim, 100 * tps);
    run(restored, 100 * tps);
    expect(restored.hash()).toBe(a.sim.hash());
  }, 120_000);
});
