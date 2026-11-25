// Heavy-clearance property test: walks every reachable cell on the real
// proto_01 map for the tier=1 clearance and is intentionally heavy
// (scenario tier).
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load';
import { CLEARANCE_HEAVY } from '../../terrain/rules/index';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';

describe('direction soundness (property)', () => {
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
});
