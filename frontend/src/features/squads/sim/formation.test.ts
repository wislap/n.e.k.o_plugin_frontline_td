import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../../core/index';
import { contentId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/index';
import { makeGrid } from '../../../testing/index';
import { createPathingModule } from '../../pathing/sim/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
} from '../../terrain/rules/index';
import { createTerrainApi } from '../../terrain/sim/index';
import {
  FORMATION_PAD,
  computeFormationLayout,
  computeGeodesicCruiseCap,
  computeGeodesicPacing,
  isFootprintFree,
  markFootprintCells,
  projectFormationSlots,
  projectSurroundArcSlots,
  type FormationMemberInfo,
} from './formation';

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

function member(handle: number, overrides: Partial<FormationMemberInfo> = {}): FormationMemberInfo {
  const radius = overrides.radius ?? 0.35;
  return {
    handle,
    id: handle as EntityId,
    x: 4.5,
    y: 4.5,
    radius,
    speed: 0.12,
    cls: 0,
    tier: radius > 0.45 ? CLEARANCE_HEAVY : CLEARANCE_STANDARD,
    range: 4,
    ...overrides,
  };
}

describe('formation layout & slot projection', () => {
  it('sorts shorter-range & heavier units to center-front and zero-range last', () => {
    const tank = member(1, { radius: 0.7, range: 3.0 });
    const rifle = member(2, { radius: 0.35, range: 5.0 });
    const sniper = member(3, { radius: 0.3, range: 8.0 });
    const flanker = member(4, { radius: 0.3, range: 3.0 });
    const unarmed = member(5, { radius: 0.35, range: 0 });
    const rocket = member(6, { radius: 0.35, range: 8.0 });

    const { offsets, halfWidth } = computeFormationLayout([
      unarmed,
      sniper,
      flanker,
      tank,
      rocket,
      rifle,
    ]);

    const oTank = offsets.get(tank.handle);
    const oFlanker = offsets.get(flanker.handle);
    const oRifle = offsets.get(rifle.handle);
    const oRocket = offsets.get(rocket.handle);
    const oSniper = offsets.get(sniper.handle);
    const oUnarmed = offsets.get(unarmed.handle);

    expect(oTank).toBeDefined();
    expect(oFlanker).toBeDefined();
    expect(oRifle).toBeDefined();
    expect(oRocket).toBeDefined();
    expect(oSniper).toBeDefined();
    expect(oUnarmed).toBeDefined();

    // Row 0 (vanguard) holds tank, flanker, rifle; row 1 (rear) holds rocket, sniper, unarmed.
    expect(oTank?.fwd).toBeGreaterThan(0);
    expect(oFlanker?.fwd).toBe(oTank?.fwd);
    expect(oRifle?.fwd).toBe(oTank?.fwd);
    expect(oRocket?.fwd).toBeLessThan(0);
    expect(oUnarmed?.fwd).toBe(oRocket?.fwd);
    expect((oTank?.fwd ?? 0) - (oRocket?.fwd ?? 0)).toBeCloseTo(0.7 + 0.35 + FORMATION_PAD, 6);

    // Within row 0, tank is center (0), flanker is right (+), rifle is left (-).
    expect(Math.abs(oTank?.right ?? 99)).toBeLessThan(0.2);
    expect(oFlanker?.right).toBeGreaterThan(oTank?.right ?? 0);
    expect(oRifle?.right).toBeLessThan(oTank?.right ?? 0);
    expect((oFlanker?.right ?? 0) - (oTank?.right ?? 0)).toBeCloseTo(0.7 + 0.3 + FORMATION_PAD, 6);
    expect(halfWidth).toBeGreaterThan(1.0);
  });

  it('tracks 1x1 and 2x2 footprints and avoids collisions and reservedCells', () => {
    const rows = Array.from({ length: 16 }, () => '.'.repeat(16));
    const terrain = createTerrainApi(makeGrid(rows), SURFACES);
    const pathing = createPathingModule(terrain, 1);

    const occupied = new Set<number>();
    markFootprintCells(occupied, terrain.width, terrain.height, 5.0, 5.0, CLEARANCE_HEAVY);
    // 2x2 anchor at (4,4) covers (4,4),(5,4),(4,5),(5,5)
    expect(isFootprintFree(occupied, terrain.width, 4.5, 4.5, CLEARANCE_STANDARD)).toBe(false);
    expect(isFootprintFree(occupied, terrain.width, 5.5, 5.5, CLEARANCE_STANDARD)).toBe(false);
    expect(isFootprintFree(occupied, terrain.width, 6.5, 4.5, CLEARANCE_STANDARD)).toBe(true);

    const heavy = member(1, { radius: 0.7, range: 3 });
    const infA = member(2, { radius: 0.35, range: 5 });
    const infB = member(3, { radius: 0.35, range: 5 });
    const members = [heavy, infA, infB];
    const { offsets } = computeFormationLayout(members);

    const reserved = new Set<number>();
    markFootprintCells(reserved, terrain.width, terrain.height, 10.5, 8.5, CLEARANCE_STANDARD);
    const reservedCell = 8 * terrain.width + 10;

    const goalId = pathing.api.acquireGoal(10, 8, 0, CLEARANCE_STANDARD);
    const slots = projectFormationSlots(
      terrain,
      pathing.api,
      goalId,
      10.5,
      8.5,
      1,
      0,
      members,
      offsets,
      reserved,
    );
    pathing.api.releaseGoal(goalId);

    // Every member gets a distinct non-overlapping footprint outside reserved.
    const claimed = new Set<number>(reserved);
    for (const m of members) {
      const s = slots.get(m.handle);
      expect(s).toBeDefined();
      if (s === undefined) {
        continue;
      }
      expect(isFootprintFree(claimed, terrain.width, s.x, s.y, m.tier)).toBe(true);
      markFootprintCells(claimed, terrain.width, terrain.height, s.x, s.y, m.tier);
      if (m.tier === CLEARANCE_STANDARD) {
        const cell =
          clearanceAnchorCell(s.y, m.tier) * terrain.width + clearanceAnchorCell(s.x, m.tier);
        expect(cell).not.toBe(reservedCell);
      }
    }
  });

  it('preserves role rank stations along 1D geodesic distances without slowing vanguard behind rear', () => {
    const pacing = computeGeodesicPacing(
      [
        { handle: 1, dist: 18.8, fwd: 1.2, speed: 0.12 }, // vanguard at d=18.8 -> station 20.0
        { handle: 2, dist: 21.2, fwd: -1.2, speed: 0.12 }, // rear at d=21.2 -> station 20.0
      ],
      10,
    );
    expect(pacing).not.toBeNull();
    if (pacing === null) {
      return;
    }
    expect(pacing.sRef).toBeCloseTo(20.0, 6);
    expect(computeGeodesicCruiseCap(0.12, 18.8, 1.2, pacing, 10)).toBe(0);
    expect(computeGeodesicCruiseCap(0.12, 21.2, -1.2, pacing, 10)).toBe(0);

    // Rear member rushing past vanguard (d=17.5 -> station 16.3, ahead +3.7) is throttled.
    const rushedRearCap = computeGeodesicCruiseCap(0.12, 17.5, -1.2, pacing, 10);
    expect(rushedRearCap).toBeGreaterThan(0);
    expect(rushedRearCap).toBeLessThan(0.12);

    // Vanguard lagging behind its station (d=22.0 -> station 20.8, ahead -0.8) runs uncapped (0).
    expect(computeGeodesicCruiseCap(0.12, 22.0, 1.2, pacing, 10)).toBe(0);
  });

  it('trimmed-median geodesic pacing rejects trapped >STRAY_DIST outliers and trims 20% tails', () => {
    const strayDist = 10;
    const pacing = computeGeodesicPacing(
      [
        { handle: 1, dist: 20.0, fwd: 0, speed: 0.2 },
        { handle: 2, dist: 20.4, fwd: 0, speed: 0.2 },
        { handle: 3, dist: 20.8, fwd: 0, speed: 0.2 },
        { handle: 4, dist: 21.0, fwd: 0, speed: 0.2 },
        { handle: 5, dist: 21.2, fwd: 0, speed: 0.2 },
        // Trapped slow member > 24 geodesic cells behind despite potentially small Euclidean gap.
        { handle: 6, dist: 45.0, fwd: 0, speed: 0.08 },
      ],
      strayDist,
    );
    expect(pacing).not.toBeNull();
    if (pacing === null) {
      return;
    }
    // Trapped outlier's 0.08 speed is excluded from in-band vCruise and its dist=45 is trimmed/filtered.
    expect(pacing.vCruise).toBeCloseTo(0.2, 6);
    // 5 in-band stations [20.0, 20.4, 20.8, 21.0, 21.2] trim 1 from each end -> mean(20.4, 20.8, 21.0).
    expect(pacing.sRef).toBeCloseTo((20.4 + 20.8 + 21.0) / 3, 6);
    expect(computeGeodesicCruiseCap(0.08, 45.0, 0, pacing, strayDist)).toBe(0);

    // With all 5 samples within strayDist, 20% trimming (trim=1) ignores top and bottom extremes.
    const trimmed = computeGeodesicPacing(
      [
        { handle: 1, dist: 15.0, fwd: 0, speed: 0.2 },
        { handle: 2, dist: 20.0, fwd: 0, speed: 0.2 },
        { handle: 3, dist: 21.0, fwd: 0, speed: 0.2 },
        { handle: 4, dist: 22.0, fwd: 0, speed: 0.2 },
        { handle: 5, dist: 30.0, fwd: 0, speed: 0.2 },
      ],
      strayDist,
    );
    expect(trimmed?.sRef).toBeCloseTo(21.0, 6);
  });

  it('computes geodesic cruise caps for null-dist, fast, ahead, lagging, and stray members', () => {
    const pacing = { sRef: 20, vCruise: 0.1, vMax: 0.2, sMed: 20 };
    const strayDist = 10;

    // Unreachable/null distance returns 0 (uncapped).
    expect(computeGeodesicCruiseCap(0.2, null, 0, pacing, strayDist)).toBe(0);

    // Fast member alongside sRef: capped to cruise speed.
    expect(computeGeodesicCruiseCap(0.2, 20.0, 0, pacing, strayDist)).toBeCloseTo(0.1, 6);

    // Uniform-speed member well ahead (sRef - station = 2.0 > 0.65): throttled smoothly.
    const aheadCap = computeGeodesicCruiseCap(0.1, 18.0, 0, pacing, strayDist);
    expect(aheadCap).toBeGreaterThan(0);
    expect(aheadCap).toBeLessThan(0.1);

    // Uniform-speed member aligned near sRef: no cap (0).
    expect(computeGeodesicCruiseCap(0.1, 19.8, 0, pacing, strayDist)).toBe(0);

    // Lagging behind (sRef - station = -1.0 < -0.75): uncapped (0) so it catches up.
    expect(computeGeodesicCruiseCap(0.2, 21.0, 0, pacing, strayDist)).toBe(0);

    // Stray (> strayDist from median): uncapped (0) so it sprints to rejoin.
    expect(computeGeodesicCruiseCap(0.2, 35.0, 0, pacing, strayDist)).toBe(0);
  });

  it('projects non-crossing surround arc slots around a hostile outside reserved vanguard cells', () => {
    const rows = Array.from({ length: 24 }, () => '.'.repeat(24));
    const terrain = createTerrainApi(makeGrid(rows), SURFACES);
    const pathing = createPathingModule(terrain, 1);

    const vanguard = member(1, { radius: 0.7, range: 2, x: 10.5, y: 12.5 });
    const leftWing = member(2, { radius: 0.35, range: 4, x: 7.5, y: 8.5 });
    const rightWing = member(3, { radius: 0.35, range: 4, x: 7.5, y: 16.5 });
    const flankerA = member(4, { radius: 0.35, range: 4, x: 8.5, y: 10.5 });
    const flankerB = member(5, { radius: 0.35, range: 4, x: 8.5, y: 14.5 });
    const members = [vanguard, leftWing, rightWing, flankerA, flankerB];
    const { offsets } = computeFormationLayout(members);

    // Hostile sits at (14.5, 12.5); vanguard holds directly west at (11.5, 12.5).
    const reserved = new Set<number>();
    markFootprintCells(reserved, terrain.width, terrain.height, 11.5, 12.5, CLEARANCE_STANDARD);
    const goalId = pathing.api.acquireGoal(14, 12, 0, CLEARANCE_STANDARD);

    const arcSlots = projectSurroundArcSlots(
      terrain,
      pathing.api,
      goalId,
      14.5,
      12.5,
      8.0,
      12.5,
      [leftWing, rightWing, flankerA, flankerB],
      offsets,
      reserved,
    );

    expect(arcSlots.size).toBe(4);
    const sLeft = arcSlots.get(leftWing.handle);
    const sRight = arcSlots.get(rightWing.handle);
    expect(sLeft).toBeDefined();
    expect(sRight).toBeDefined();
    // 2-opt uncrossing keeps north member (y=8.5) on north side of south member (y=16.5).
    expect(sLeft?.y ?? 99).toBeLessThan(sRight?.y ?? -99);
    // All projected slots sit outside the reserved cell and roughly within weapon range arc.
    for (const s of arcSlots.values()) {
      expect(
        clearanceAnchorCell(s.x, CLEARANCE_STANDARD) === 11 &&
          clearanceAnchorCell(s.y, CLEARANCE_STANDARD) === 12,
      ).toBe(false);
      const distToEnemy = Math.sqrt((s.x - 14.5) * (s.x - 14.5) + (s.y - 12.5) * (s.y - 12.5));
      expect(distToEnemy).toBeGreaterThanOrEqual(2.5);
      expect(distToEnemy).toBeLessThanOrEqual(6.0);
    }
    pathing.api.releaseGoal(goalId);
  });
});
