// Assault director scenario: squad tags, wave-strength pinning and
// wave probe counts. One shared 200 s run feeds all three tests.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Simulation } from '../kernel/index';
import type { SquadsSnapshot } from '../features/squads/protocol';
import type { DenseUnits } from '../features/units/protocol';
import { TPS, dense, resolved, run, squads } from './test-world';

describe('assault director', () => {
  let sim: Simulation;
  let snap100: SquadsSnapshot;
  let snap160: SquadsSnapshot;
  let snap200: SquadsSnapshot;
  let probes160: Record<string, number>;
  let dense160: DenseUnits;

  beforeAll(() => {
    sim = resolved().sim;
    run(sim, 100 * TPS);
    snap100 = squads(sim);
    run(sim, 60 * TPS);
    snap160 = squads(sim);
    probes160 = sim.probes();
    dense160 = dense(sim);
    run(sim, 40 * TPS);
    snap200 = squads(sim);
  }, 60_000);

  it('identifies its squads by tag', () => {
    const tags = snap100.squads.map((s) => s.tag).sort();
    expect(tags).toContain('hive_guard');
    expect(tags).toContain('raid');
    expect(tags).toContain('wave:1');
  });

  it('pins wave strength at launch so later spawns stay unassigned', () => {
    // Past the first launch (gather 90 s + window 60 s = 150 s).
    const wave = snap160.squads.find((s) => s.tag === 'wave:1');
    expect(wave).toBeDefined();
    expect(wave?.order.kind === 'advance' || wave?.order.kind === 'guard').toBe(true);
    const members = wave?.members?.length ?? 0;
    expect(wave?.strength).toBe(members);
    // The hive keeps producing; new monsters must not join the launched wave.
    const later = snap200.squads.find((s) => s.tag === 'wave:1');
    if (later !== undefined) {
      expect(later.members?.length ?? 0).toBeLessThanOrEqual(members);
    }
  });

  it('hive spawns feed the gather squad and waves probe counts', () => {
    expect(probes160['frontline_td:assault.waves.f2'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(probes160['frontline_td:assault.hivehp.f2'] ?? -1).toBeGreaterThan(0);
    const enemy = Array.from(dense160.faction).filter((f) => f === 2).length;
    // Hive production plus initial monsters.
    expect(enemy).toBeGreaterThan(16);
  });
});
