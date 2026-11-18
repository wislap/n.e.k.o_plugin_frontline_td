// Assault director scenario: per-outpost garrison formation, hive_guard
// composition, and garrison recreation. The two read-only 60 s checks
// share one run; recreation needs its own mutable sim.
import { beforeAll, describe, expect, it } from 'vitest';
import { toTick } from '../core/index';
import { SquadsDisband } from '../features/squads/protocol';
import type { SquadsSnapshot } from '../features/squads/protocol';
import type { DenseUnits } from '../features/units/protocol';
import { F2, TPS, dense, resolved, run, squads } from './test-world';
import type { Simulation } from '../kernel/index';

describe('assault garrisons', () => {
  let sim60: Simulation;
  let snap: SquadsSnapshot;
  let dense60: DenseUnits;

  beforeAll(() => {
    sim60 = resolved().sim;
    run(sim60, 60 * TPS);
    snap = squads(sim60);
    dense60 = dense(sim60);
  }, 60_000);

  it('forms per-outpost garrisons at init that hold near their outposts', () => {
    const pos = new Map<number, { x: number; y: number }>();
    for (let i = 0; i < dense60.handles.length; i++) {
      pos.set(dense60.handles[i] ?? 0, { x: dense60.x[i] ?? 0, y: dense60.y[i] ?? 0 });
    }
    // proto_01 outpost footprints (top-left) → centres.
    const outposts = [
      { tag: 'garrison:30,55', cx: 31.5, cy: 56.5 },
      { tag: 'garrison:26,21', cx: 27.5, cy: 22.5 },
      { tag: 'garrison:69,21', cx: 70.5, cy: 22.5 },
    ];
    for (const o of outposts) {
      const g = snap.squads.find((s) => s.tag === o.tag);
      expect(g).toBeDefined();
      expect(g?.order.kind).toBe('guard');
      expect(g?.order.x).toBeCloseTo(o.cx);
      expect(g?.order.y).toBeCloseTo(o.cy);
      expect(g?.strength).toBe(6);
      expect(g?.memberCount ?? 0).toBeGreaterThan(0);
      // Most members hold at the outpost; reinforcement arrivals may
      // still be walking in from the hive.
      const near = (g?.members ?? []).filter((h) => {
        const p = pos.get(h);
        if (p === undefined) {
          return false;
        }
        const dx = p.x - o.cx;
        const dy = p.y - o.cy;
        return dx * dx + dy * dy <= 64;
      }).length;
      expect(near).toBeGreaterThanOrEqual(Math.ceil((g?.memberCount ?? 0) / 2));
    }
  });

  it('hive_guard guards the hive centre and excludes garrison monsters', () => {
    const garrisons = snap.squads.filter((s) => s.tag?.startsWith('garrison:'));
    // South 4, west 6, east 6 garrison monsters at init; generic
    // reinforcement may top the south garrison up to strength 6.
    expect(garrisons.reduce((n, s) => n + s.memberCount, 0)).toBeGreaterThanOrEqual(16);
    const guard = snap.squads.find((s) => s.tag === 'hive_guard');
    expect(guard).toBeDefined();
    expect(guard?.order.kind).toBe('guard');
    // Hive footprint 4x4 at enemy_north (30,4) → centre (32,6), not the
    // centroid of all monsters.
    expect(Math.abs((guard?.order.x ?? 0) - 32)).toBeLessThan(0.5);
    expect(Math.abs((guard?.order.y ?? 0) - 6)).toBeLessThan(0.5);
    // Remaining non-raider monsters: the 16 enemy_north monsters.
    expect(guard?.memberCount).toBe(16);
  });

  it('recreates a destroyed garrison from unassigned monsters', () => {
    const sim = sim60;
    const g = squads(sim).squads.find((s) => s.tag === 'garrison:26,21');
    expect(g).toBeDefined();
    if (g === undefined) {
      return;
    }
    sim.submit({
      tick: toTick(sim.tick + 1),
      issuer: F2,
      type: SquadsDisband.type,
      payload: { squad: g.id },
    });
    // A few decide ticks: the disbanded members are unassigned, so the
    // garrison is recreated and re-ordered to guard.
    run(sim, 60);
    const recreated = squads(sim).squads.find((s) => s.tag === 'garrison:26,21');
    expect(recreated).toBeDefined();
    expect(recreated?.memberCount ?? 0).toBeGreaterThan(0);
    expect(recreated?.order.kind).toBe('guard');
  });
});
