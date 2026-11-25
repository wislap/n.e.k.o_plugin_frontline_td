// Direction-soundness property tests: these walk every reachable cell
// on the real proto_01 map and are intentionally heavy (scenario tier).
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';

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
});
