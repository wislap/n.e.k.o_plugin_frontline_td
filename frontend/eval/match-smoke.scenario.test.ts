// Whole-match golden + behaviour smoke (governance batch step 2): a
// balanced bot vs the assault director on proto_01, 5 simulated minutes.
// Besides the golden hash it checks health invariants each sampled
// second: waves actually launch, no squad pins in resupplying, every
// unit stays at a finite in-bounds position.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/index';
import { toFactionId } from '../src/core/index';
import type { Simulation } from '../src/kernel/index';
import { defaultSetup } from '../src/modes/assault/index';
import { resolveSetup } from '../src/app/resolve-setup';
import { SquadsChannel } from '../src/features/squads/protocol';
import type { SquadsSnapshot } from '../src/features/squads/protocol';
import { DenseUnitsChannel } from '../src/features/units/protocol';
import type { DenseUnits } from '../src/features/units/protocol';
import { createBalancedBot } from './bots/balanced';

const PLAYER = toFactionId(1);
const ENEMY = toFactionId(2);
const TPS = 20;
const TICKS = 6000; // 5 minutes
const SAMPLE_EVERY = 20; // 1 s
const RESUPPLY_LIMIT = 120 * TPS; // continuous resupplying budget

// Golden hash (Batch P3 / ADR 0057: scalar FormationGuide pacing, 1D
// geodesic trimmed-median cruise synchronization, O(1) squad reachability
// checks, and 1-tick immediate SquadsOrder/SquadsGather start): rule changes
// may legitimately change it — update the constant in the same commit and
// say why in the commit message.
const GOLDEN_HASH = 'b04a3401ea69b698';

describe('match smoke (proto_01, balanced bot vs director)', () => {
  it('plays 5 minutes: hash golden, waves launch, sane unit state', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    if (map === undefined) {
      throw new Error('proto_01 missing');
    }
    const r = resolveSetup(defaultSetup(1), {
      controllerFor: (faction) =>
        Number(faction) === Number(PLAYER)
          ? createBalancedBot({ faction: PLAYER, db, map, hostile: new Set([Number(ENEMY)]) })
          : undefined,
    });
    if ('error' in r) {
      throw new Error(r.error);
    }
    const sim: Simulation = r.sim;

    // Squad id → tick at which its current resupplying streak began
    // (squads absent from a sample reset the streak).
    const resupplySince = new Map<number, number>();
    let maxResupply = 0;
    for (let t = 0; t < TICKS; t++) {
      sim.step();
      if ((t + 1) % SAMPLE_EVERY !== 0) {
        continue;
      }
      const tick = t + 1;
      const snap = sim.snapshot(ENEMY);
      const squads = snap.channels[SquadsChannel.id] as SquadsSnapshot;
      const seen = new Set<number>();
      for (const squad of squads.squads) {
        if (squad.phase !== 'resupplying') {
          continue;
        }
        seen.add(squad.id);
        if (!resupplySince.has(squad.id)) {
          resupplySince.set(squad.id, tick);
        }
        maxResupply = Math.max(maxResupply, tick - (resupplySince.get(squad.id) ?? tick));
      }
      for (const id of [...resupplySince.keys()]) {
        if (!seen.has(id)) {
          resupplySince.delete(id);
        }
      }
      const dense = snap.channels[DenseUnitsChannel.id] as DenseUnits;
      for (let i = 0; i < dense.x.length; i++) {
        const x = dense.x[i] ?? NaN;
        const y = dense.y[i] ?? NaN;
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x >= 0 && x <= map.width && y >= 0 && y <= map.height).toBe(true);
      }
    }

    expect(sim.hash()).toBe(GOLDEN_HASH);
    expect(sim.probes()['frontline_td:assault.waves.f2'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(maxResupply).toBeLessThanOrEqual(RESUPPLY_LIMIT);
  }, 60_000);
});
