// combat.nearestHostile / weaponRange (A2): the public query reads the
// bucket grid built by the last combat_intent run — called from orders
// it intentionally sees the previous tick's positions (documented
// staleness). Ties are deterministic by entity id.
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../../core/index';
import { toFactionId } from '../../../core/index';
import type { SimModule, SystemContext } from '../../../kernel/index';
import { F1, makeWorld, ROBOT, robotInit, run } from './test-world';
import type { BuiltWorld } from './test-world';
import type { CombatModule } from './module';

const F2 = toFactionId(2);
const ROWS = ['.' + '.'.repeat(19)];

// Orders-phase probe recording the query results each tick.
function probe(world: () => BuiltWorld, out: (EntityId | null | number)[]): SimModule {
  return {
    id: 'frontline_td:test.q',
    install(builder) {
      builder.system({
        id: 'frontline_td:test.q',
        phase: 'orders',
        run(ctx: SystemContext) {
          const w = world();
          const combat: CombatModule = w.combat;
          const first = w.alive(0);
          const second = w.alive(1);
          out.push(combat.nearestHostile(ctx, F1, 8, 0, 30));
          // Filter excludes the nearer unit.
          out.push(combat.nearestHostile(ctx, F1, 8, 0, 30, (id) => id !== first));
          // Out-of-radius and same-faction cases.
          out.push(combat.nearestHostile(ctx, F1, 8, 0, 0.1));
          out.push(combat.nearestHostile(ctx, F2, 8, 0, 30));
          if (second >= 0) {
            out.push(combat.weaponRange(ctx, second as EntityId));
          }
        },
      });
    },
  };
}

describe('combat.nearestHostile', () => {
  it('returns the nearest hostile, ties by lowest entity id', () => {
    const out: (EntityId | null | number)[] = [];
    // The probe closes over w (assigned by makeWorld); w.combat exists
    // before the first run() tick.
    const w = makeWorld({
      rows: ROWS,
      entities: [
        { parts: robotInit(ROBOT, 7, 0), faction: 2 },
        { parts: robotInit(ROBOT, 9, 0), faction: 2 },
      ],
      factions: [1, 2],
      extraModules: [probe(() => w, out)],
    });
    run(w, 2);
    // The orders probe at tick 0 sees an empty grid (combat_intent has
    // not run yet — the documented one-phase staleness); tick-1 entries
    // (indices 5–9) read the grid built in tick 0.
    expect(out[0]).toBeNull();
    // Equidistant hostiles → lowest id (first spawned).
    expect(out[5]).toBe(w.alive(0));
    expect(out[6]).toBe(w.alive(1));
    expect(out[7]).toBeNull();
    expect(out[8]).toBeNull();
    expect(out[9]).toBeGreaterThan(0); // weaponRange
  });
});
