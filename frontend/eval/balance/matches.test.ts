import { describe, expect, it } from 'vitest';
import { resolveSetup } from '../../src/app/resolve-setup';
import { toFactionId } from '../../src/core/index';
import { defaultSetup } from '../../src/modes/assault/index';
import { readPlayerStockSample } from './matches';

describe('readPlayerStockSample', () => {
  it('reads whole-unit starting core reserves from real assault sim.probes()', () => {
    const resolved = resolveSetup(defaultSetup(1));
    if ('error' in resolved) {
      throw new Error(`resolveSetup failed: ${resolved.error}`);
    }
    const { sim } = resolved;
    sim.step();

    const probes = sim.probes();
    const sample = readPlayerStockSample(Number(sim.tick), probes, toFactionId(1));

    expect(sample.tick).toBe(1);
    expect(sample.material).toBeGreaterThan(0);
    expect(sample.energy).toBeGreaterThan(0);
    expect(sample.ammo).toBeGreaterThan(0);
    expect(sample.material).toBe(probes['frontline_td:assault.stock.f1.material']);
    expect(sample.ore).toBe(probes['frontline_td:assault.stock.f1.ore']);
    expect(sample.energy).toBe(probes['frontline_td:assault.stock.f1.energy']);
    expect(sample.ammo).toBe(probes['frontline_td:assault.stock.f1.ammo']);
    expect(Number.isInteger(sample.material)).toBe(true);
    expect(Number.isInteger(sample.energy)).toBe(true);
    expect(Number.isInteger(sample.ammo)).toBe(true);
  });
});
