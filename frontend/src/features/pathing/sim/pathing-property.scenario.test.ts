// Direction-soundness property tests: these walk every reachable cell
// on the real proto_01 map and are intentionally heavy (scenario tier).
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
import { CLS, makePathing } from './test-world';

describe('direction soundness (property)', () => {
  // proto_01, ground class: for several goals, every emitted direction must be
  // a passable step, and following the field from any reachable cell must
  // reach the goal without loops or dead ends.
  it('every direction is a passable step and reaches the goal on proto_01', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const terrain = createTerrainApi(map.grid, db.surfaces.list);
    const { api } = createPathingModule(terrain, db.movementClasses.list.length);
    const ground = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
    const goalCells = [
      map.points['player_start'],
      map.points['enemy_north'],
      map.points['enemy_east'],
      // A cell on the far (east) side of the river ford.
      { x: 60, y: 47 },
    ];
    for (const g of goalCells) {
      expect(g).toBeDefined();
      if (g === undefined) {
        continue;
      }
      const goal = api.acquireGoal(g.x, g.y, ground);
      for (let y = 0; y < terrain.height; y++) {
        for (let x = 0; x < terrain.width; x++) {
          const d = api.directionAt(goal, x, y);
          if (d === null || (d.dx === 0 && d.dy === 0)) {
            continue;
          }
          const step = terrain.stepCost(x, y, x + d.dx, y + d.dy, ground);
          expect(
            step,
            `impassable direction at ${x},${y} -> ${x + d.dx},${y + d.dy}`,
          ).toBeGreaterThanOrEqual(0);
          // Follow the field to the goal; bounded steps => no loop/dead end.
          let cx = x;
          let cy = y;
          const limit = terrain.width * terrain.height;
          let k = 0;
          while (k < limit) {
            const dd = api.directionAt(goal, cx, cy);
            expect(dd, `dead end at ${cx},${cy} for goal ${g.x},${g.y}`).not.toBeNull();
            if (dd === null) {
              break;
            }
            if (dd.dx === 0 && dd.dy === 0) {
              break;
            }
            cx += dd.dx;
            cy += dd.dy;
            k++;
          }
          expect(
            cx === g.x && cy === g.y,
            `field from ${x},${y} did not reach goal ${g.x},${g.y} (ended ${cx},${cy})`,
          ).toBe(true);
        }
      }
      api.releaseGoal(goal);
    }
  }, 30_000); // Walking every reachable cell across four goals is heavy.

  it('plateau-edge cells never point off the cliff', () => {
    // 5x5: plateau height 1 everywhere except a ring of height 0; the only
    // exit is the ramp at (1,2) (lower cell). Goal below the plateau.
    const rows = ['.....', '.111.', '.r11.', '.111.', '.....'];
    const { api, terrain } = makePathing(rows);
    const goal = api.acquireGoal(2, 4, CLS);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        const d = api.directionAt(goal, x, y);
        if (d === null || (d.dx === 0 && d.dy === 0)) {
          continue;
        }
        expect(
          terrain.stepCost(x, y, x + d.dx, y + d.dy, CLS),
          `cliff step from ${x},${y} to ${x + d.dx},${y + d.dy}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
    // Following the field from the plateau interior exits via the ramp.
    let x = 2;
    let y = 1;
    for (let k = 0; k < 25; k++) {
      const d = api.directionAt(goal, x, y);
      if (d === null || (d.dx === 0 && d.dy === 0)) {
        break;
      }
      x += d.dx;
      y += d.dy;
    }
    expect(x).toBe(2);
    expect(y).toBe(4);
  });

  it('every tier=1 direction on proto_01 is a passable heavy step and reaches the goal', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const terrain = createTerrainApi(map.grid, db.surfaces.list);
    const { api } = createPathingModule(terrain, db.movementClasses.list.length);
    const ground = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
    const candidates = [
      map.points['player_start'],
      map.points['enemy_north'],
      map.points['enemy_east'],
      { x: 60, y: 47 },
    ];
    let testedGoals = 0;
    for (const g of candidates) {
      if (g === undefined || !terrain.passable(g.x, g.y, ground, CLEARANCE_HEAVY)) {
        continue;
      }
      testedGoals += 1;
      const goal = api.acquireGoal(g.x, g.y, ground, CLEARANCE_HEAVY);
      let reachableCells = 0;
      for (let y = 0; y < terrain.height; y++) {
        for (let x = 0; x < terrain.width; x++) {
          const d = api.directionAt(goal, x, y);
          if (d === null || (d.dx === 0 && d.dy === 0)) {
            continue;
          }
          reachableCells += 1;
          const step = terrain.stepCost(x, y, x + d.dx, y + d.dy, ground, CLEARANCE_HEAVY);
          expect(
            step,
            `impassable heavy direction at ${x},${y} -> ${x + d.dx},${y + d.dy}`,
          ).toBeGreaterThanOrEqual(0);
          let cx = x;
          let cy = y;
          const limit = terrain.width * terrain.height;
          let k = 0;
          while (k < limit) {
            const dd = api.directionAt(goal, cx, cy);
            expect(dd, `heavy dead end at ${cx},${cy} for goal ${g.x},${g.y}`).not.toBeNull();
            if (dd === null || (dd.dx === 0 && dd.dy === 0)) {
              break;
            }
            cx += dd.dx;
            cy += dd.dy;
            k++;
          }
          expect(
            cx === g.x && cy === g.y,
            `heavy field from ${x},${y} did not reach goal ${g.x},${g.y} (ended ${cx},${cy})`,
          ).toBe(true);
        }
      }
      expect(reachableCells).toBeGreaterThan(0);
      api.releaseGoal(goal);
    }
    expect(testedGoals).toBeGreaterThan(0);
  }, 30_000);

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

  it('open-ground trajectories across sector-sized spans are near-Euclidean and non-divergent on proto_01', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const terrain = createTerrainApi(map.grid, db.surfaces.list);
    const { api } = createPathingModule(terrain, db.movementClasses.list.length);
    const ground = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;

    const cases: readonly { label: string; sx: number; sy: number; gx: number; gy: number }[] = [
      { label: 'horizontal across x=16, 32', sx: 10, sy: 2, gx: 45, gy: 2 },
      { label: 'off-axis diagonal', sx: 2, sy: 2, gx: 28, gy: 7 },
      { label: 'former sector-seam line', sx: 5, sy: 32, gx: 35, gy: 32 },
      { label: 'former corner-split (14,14)', sx: 14, sy: 14, gx: 35, gy: 15 },
      { label: 'former corner-split (14,15)', sx: 14, sy: 15, gx: 35, gy: 15 },
      { label: 'former corner-split (14,16)', sx: 14, sy: 16, gx: 35, gy: 15 },
      { label: 'former corner-split (15,15)', sx: 15, sy: 15, gx: 35, gy: 15 },
      { label: 'former corner-split (15,16)', sx: 15, sy: 16, gx: 35, gy: 15 },
    ];

    const step = 0.25;
    for (const c of cases) {
      const goal = api.acquireGoal(c.gx, c.gy, ground, CLEARANCE_STANDARD);
      const startX = c.sx + 0.5;
      const startY = c.sy + 0.5;
      const targetX = c.gx + 0.5;
      const targetY = c.gy + 0.5;
      const segDx = targetX - startX;
      const segDy = targetY - startY;
      const euclideanDist = Math.sqrt(segDx * segDx + segDy * segDy);

      let px = startX;
      let py = startY;
      let walkedDist = 0;
      let maxPerpDist = 0;
      let reached = false;
      const maxSteps = Math.ceil((euclideanDist * 2) / step) + 16;

      for (let k = 0; k < maxSteps; k++) {
        const perpDist =
          Math.abs(segDy * px - segDx * py + targetX * startY - targetY * startX) / euclideanDist;
        if (perpDist > maxPerpDist) {
          maxPerpDist = perpDist;
        }
        const dxToTarget = px - targetX;
        const dyToTarget = py - targetY;
        if (Math.sqrt(dxToTarget * dxToTarget + dyToTarget * dyToTarget) <= 0.5) {
          reached = true;
          break;
        }
        const d = api.smoothDirectionAt(goal, px, py);
        expect(d, `${c.label}: smoothDirectionAt returned null at (${px}, ${py})`).not.toBeNull();
        if (d === null) {
          break;
        }
        if (d.dx === 0 && d.dy === 0) {
          reached = true;
          break;
        }
        px += d.dx * step;
        py += d.dy * step;
        walkedDist += step;
      }

      const endPerpDist =
        Math.abs(segDy * px - segDx * py + targetX * startY - targetY * startX) / euclideanDist;
      if (endPerpDist > maxPerpDist) {
        maxPerpDist = endPerpDist;
      }

      expect(reached, `${c.label}: did not reach goal (${c.gx},${c.gy})`).toBe(true);
      expect(
        walkedDist / euclideanDist,
        `${c.label}: walked/euclid=${(walkedDist / euclideanDist).toFixed(4)}`,
      ).toBeLessThanOrEqual(1.03);
      expect(maxPerpDist, `${c.label}: maxPerpDist=${maxPerpDist.toFixed(4)}`).toBeLessThanOrEqual(
        1.0,
      );

      api.releaseGoal(goal);
    }
  });
});
