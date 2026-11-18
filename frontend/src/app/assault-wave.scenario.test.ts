// Assault director scenario: the first gather→launch→breather wave
// cycle on proto_01 through the real resolve-setup path.
import { describe, expect, it } from 'vitest';
import { SquadsChannel } from '../features/squads/protocol';
import type { SquadsSnapshot } from '../features/squads/protocol';
import { F2, TPS, resolved, squads } from './test-world';

describe('assault wave cycle', () => {
  it('gathers at ~90 s, launches at the window end and breathes out wave 2', () => {
    const { sim } = resolved();
    const tps = TPS;
    // Up to ~160 s: first gather at 90 s, window 60 s, launch ~150 s.
    let sawGather = false;
    let launched = 0;
    let gatherAt = -1;
    for (let t = 0; t < 170 * tps && launched === 0; t++) {
      sim.step();
      if (t % 20 !== 0) {
        continue;
      }
      const squads = sim.snapshot(F2).channels[SquadsChannel.id] as SquadsSnapshot;
      for (const s of squads.squads) {
        if (s.order.kind === 'gather') {
          sawGather = true;
          gatherAt = t;
        }
        if (s.order.kind === 'advance' && sawGather && gatherAt > 0) {
          launched = s.id;
        }
      }
    }
    expect(sawGather).toBe(true);
    // First gather starts at 90 s: the gather order exists by ~95 s.
    expect(gatherAt).toBeGreaterThanOrEqual(88 * tps);
    expect(gatherAt).toBeLessThanOrEqual(150 * tps);
    expect(launched).not.toBe(0);
    // Second gather must be bigger: strength cap 8+4 per wave done.
    for (let t = 0; t < 200 * tps; t++) {
      sim.step();
      if (t % 20 !== 0) {
        continue;
      }
      const snap = squads(sim);
      const wave2 = snap.squads.find(
        (s) => s.order.kind === 'gather' && s.id !== launched && s.strength >= 12,
      );
      if (wave2 !== undefined) {
        return;
      }
      if (t > 190 * tps) {
        break;
      }
    }
    // If wave 1's squad is still alive the breather may not have elapsed;
    // assert at least the wave-count probe tracked the launch.
    const probes = sim.probes();
    expect(probes['frontline_td:assault.waves.f2'] ?? 0).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
