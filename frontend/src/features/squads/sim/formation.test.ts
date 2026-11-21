import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../../core/index';
import { contentId, distance } from '../../../core/index';
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
  GUIDE_LOOKAHEAD,
  LEADER_MAX_LEAD,
  MIN_WIDTH_SCALE,
  advanceLeaderAnchor,
  computeCruiseCap,
  computeFormationLayout,
  isFootprintFree,
  markFootprintCells,
  probeCorridorWidth,
  projectFormationSlots,
  type FormationMemberInfo,
} from './formation';
import type { SquadAnchor } from './state';

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
      1,
      1,
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

  it('probes corridor width and shifts centerBias away from closer wall', () => {
    // Passable rows y=4..8, walls at y<=3 and y>=9.
    const rows = Array.from({ length: 14 }, (_, y) =>
      y >= 4 && y <= 8 ? '.'.repeat(16) : '#'.repeat(16),
    );
    const terrain = createTerrainApi(makeGrid(rows), SURFACES);

    // Heading east (+1, 0), right perpendicular is (0, +1).
    // At y=7.5: +r hits wall at y=9 (rightClear=1.0), -r open until y=3 (leftClear=3.5).
    const probe = probeCorridorWidth(terrain, 0, CLEARANCE_STANDARD, 8.5, 7.5, 0, 1, 3.0);
    expect(probe.availHalf).toBeCloseTo(2.25, 5);
    expect(probe.centerBias).toBeLessThan(0);
    expect(probe.centerBias).toBeGreaterThanOrEqual(-1.5);
  });

  it('advances anchor, pulls rubber band, compresses widthScale in choke, and expands in open ground', () => {
    // 32x15 map: walls at x=12..16 leaving a 2-cell choke at y=7..8.
    const rows = Array.from({ length: 15 }, (_, y) => {
      const chars = '.'.repeat(32).split('');
      if (y !== 7 && y !== 8) {
        for (let x = 12; x <= 16; x++) {
          chars[x] = '#';
        }
      }
      return chars.join('');
    });
    const terrain = createTerrainApi(makeGrid(rows), SURFACES);
    const pathing = createPathingModule(terrain, 1);
    const goalId = pathing.api.acquireGoal(28, 7, 0, CLEARANCE_STANDARD);

    // 1. Rubber-band pull-back when anchor is > 2 * LEADER_MAX_LEAD ahead of centroid.
    const farAnchor: SquadAnchor = {
      x: 20,
      y: 7.5,
      hx: 1,
      hy: 0,
      halfWidth: 2.5,
      widthScale: 1,
    };
    advanceLeaderAnchor(
      terrain,
      pathing.api,
      goalId,
      farAnchor,
      28.5,
      7.5,
      5.5,
      7.5,
      0,
      CLEARANCE_STANDARD,
      0.15,
      2.5,
      10,
    );
    expect(farAnchor.x).toBeLessThan(20);
    expect(farAnchor.x).toBeCloseTo(20 + (5.5 - 20) * 0.5, 5);

    // 2. Choke compression and open-ground recovery.
    const chokeAnchor: SquadAnchor = {
      x: 11.0,
      y: 7.5,
      hx: 1,
      hy: 0,
      halfWidth: 3.0,
      widthScale: 1.0,
    };
    const chokeOut = advanceLeaderAnchor(
      terrain,
      pathing.api,
      goalId,
      chokeAnchor,
      28.5,
      7.5,
      10.5,
      7.5,
      0,
      CLEARANCE_STANDARD,
      0.15,
      3.0,
      10,
    );
    expect(chokeOut.widthScale).toBeLessThan(0.8);
    expect(chokeOut.widthScale).toBeGreaterThanOrEqual(MIN_WIDTH_SCALE);
    expect(chokeOut.depthScale).toBeGreaterThan(1.0);

    // Now move into open field beyond the choke and verify widthScale recovers upward.
    const openAnchor: SquadAnchor = {
      x: 22.0,
      y: 7.5,
      hx: 1,
      hy: 0,
      halfWidth: 3.0,
      widthScale: chokeOut.widthScale,
    };
    const openOut = advanceLeaderAnchor(
      terrain,
      pathing.api,
      goalId,
      openAnchor,
      28.5,
      7.5,
      21.5,
      7.5,
      0,
      CLEARANCE_STANDARD,
      0.15,
      3.0,
      10,
    );
    expect(openOut.widthScale).toBeGreaterThan(chokeOut.widthScale);
    expect(distance(21.5, 7.5, openAnchor.x, openAnchor.y)).toBeLessThanOrEqual(LEADER_MAX_LEAD);
    const guideLead = distance(
      openAnchor.x,
      openAnchor.y,
      openOut.guideCenterX,
      openOut.guideCenterY,
    );
    expect(guideLead).toBeGreaterThan(1.5);
    expect(guideLead).toBeLessThanOrEqual(GUIDE_LOOKAHEAD + 0.05);

    pathing.api.releaseGoal(goalId);
  });

  it('computes cruise caps for fast, ahead, lagging, and stray members', () => {
    const cruise = 0.1;
    const strayDist = 10;

    // Fast member alongside slot: capped to cruise speed.
    expect(computeCruiseCap(0.2, 5.0, 5.0, 5.0, 5.0, 1, 0, cruise, strayDist)).toBeCloseTo(0.1, 6);

    // Uniform-speed member well ahead (> 0.75): throttled smoothly.
    const aheadCap = computeCruiseCap(0.1, 6.75, 5.0, 5.0, 5.0, 1, 0, cruise, strayDist);
    expect(aheadCap).toBeGreaterThan(0);
    expect(aheadCap).toBeLessThan(0.1);

    // Uniform-speed member aligned with slot: no cap (0).
    expect(computeCruiseCap(0.1, 5.2, 5.0, 5.0, 5.0, 1, 0, cruise, strayDist)).toBe(0);

    // Lagging behind slot (ahead < -0.75): uncapped (0) so it catches up.
    expect(computeCruiseCap(0.2, 4.0, 5.0, 5.0, 5.0, 1, 0, cruise, strayDist)).toBe(0);

    // Stray (> strayDist): uncapped (0) so it sprints to rejoin.
    expect(computeCruiseCap(0.2, 20.0, 5.0, 5.0, 5.0, 1, 0, cruise, strayDist)).toBe(0);
  });
});
