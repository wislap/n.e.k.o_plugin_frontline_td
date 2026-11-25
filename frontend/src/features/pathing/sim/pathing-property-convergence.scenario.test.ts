// Continuous-integration property test: integrates smoothDirectionAt
// across the real proto_01 map for both clearance tiers and is
// intentionally heavy (scenario tier).
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  type ClearanceTier,
} from '../../terrain/rules/index';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';

describe('direction soundness (property)', () => {
  it('continuous sub-cell integration along smoothDirectionAt converges on proto_01 for tier=0 and tier=1', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const terrain = createTerrainApi(map.grid, db.surfaces.list);
    const { api } = createPathingModule(terrain, db.movementClasses.list.length);
    const ground = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
    const goalCandidates = [map.points['player_start'], { x: 60, y: 47 }];
    const stepSize = 0.25;

    for (const tier of [
      CLEARANCE_STANDARD,
      CLEARANCE_HEAVY,
    ] as const satisfies readonly ClearanceTier[]) {
      let testedGoals = 0;
      for (const g of goalCandidates) {
        if (g === undefined || !terrain.passable(g.x, g.y, ground, tier)) {
          continue;
        }
        testedGoals += 1;
        const goal = api.acquireGoal(g.x, g.y, ground, tier);
        let testedStarts = 0;
        const maxSteps = (terrain.width + terrain.height) * 8;
        for (let sy = 2; sy < terrain.height - 2; sy += 6) {
          for (let sx = 2; sx < terrain.width - 2; sx += 6) {
            if (api.directionAt(goal, sx, sy) === null) {
              continue;
            }
            testedStarts += 1;
            let px = clearanceAnchorCenter(sx, tier);
            let py = clearanceAnchorCenter(sy, tier);
            let prevAx = sx;
            let prevAy = sy;
            let sameCellSteps = 0;
            let reached = false;
            for (let k = 0; k < maxSteps; k++) {
              const d = api.smoothDirectionAt(goal, px, py);
              expect(
                d,
                `smoothDirectionAt returned null at (${px.toFixed(2)}, ${py.toFixed(2)}) tier=${tier}`,
              ).not.toBeNull();
              if (d === null) {
                break;
              }
              const ax = clearanceAnchorCell(px, tier);
              const ay = clearanceAnchorCell(py, tier);
              if (d.dx === 0 && d.dy === 0) {
                expect(ax).toBe(g.x);
                expect(ay).toBe(g.y);
                reached = true;
                break;
              }
              expect(Math.sqrt(d.dx * d.dx + d.dy * d.dy)).toBeCloseTo(1, 5);
              px += d.dx * stepSize;
              py += d.dy * stepSize;
              const nax = clearanceAnchorCell(px, tier);
              const nay = clearanceAnchorCell(py, tier);
              expect(
                terrain.passable(nax, nay, ground, tier),
                `stepped onto impassable anchor (${nax},${nay}) from (${px.toFixed(2)},${py.toFixed(2)}) tier=${tier}`,
              ).toBe(true);
              if (nax === prevAx && nay === prevAy) {
                sameCellSteps += 1;
                expect(
                  sameCellSteps,
                  `stalled inside anchor (${nax},${nay}) tier=${tier}`,
                ).toBeLessThanOrEqual(16);
              } else {
                prevAx = nax;
                prevAy = nay;
                sameCellSteps = 0;
              }
            }
            expect(
              reached,
              `particle from (${sx},${sy}) tier=${tier} failed to converge to (${g.x},${g.y})`,
            ).toBe(true);
          }
        }
        expect(testedStarts).toBeGreaterThan(0);
        api.releaseGoal(goal);
      }
      expect(testedGoals).toBeGreaterThan(0);
    }
  }, 30_000);
});
