import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load';
import { CLEARANCE_STANDARD } from '../../terrain/rules/index';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';

describe('direction soundness (property)', () => {
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
