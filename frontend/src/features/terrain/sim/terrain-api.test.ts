import { describe, expect, it } from 'vitest';
import { contentId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { loadContent } from '../../../content/load';
import type { TerrainGrid } from '../content';
import { createTerrainApi } from './terrain-api';

const CLS = 0;

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

function makeGrid(
  heights: number[],
  ramps: number[],
  surfaceIds: number[],
  w: number,
): TerrainGrid {
  return {
    width: w,
    height: heights.length / w,
    heights: Uint8Array.from(heights),
    surfaces: Uint16Array.from(surfaceIds),
    ramps: Uint8Array.from(ramps),
  };
}

// 3x1 strip: flat ground
const flat = createTerrainApi(makeGrid([0, 0, 0], [0, 0, 0], [0, 0, 0], 3), SURFACES);

describe('TerrainApi edge rule', () => {
  it('allows a flat orthogonal step with cost of the target cell', () => {
    expect(flat.stepCost(0, 0, 1, 0, CLS)).toBe(10);
  });

  it('rejects a cliff of |dh|>1', () => {
    const api = createTerrainApi(makeGrid([0, 2, 0], [0, 0, 0], [0, 0, 0], 3), SURFACES);
    expect(api.stepCost(0, 0, 1, 0, CLS)).toBe(-1);
  });

  it('rejects a 1-high step unless the lower cell is a ramp', () => {
    const noRamp = createTerrainApi(makeGrid([0, 1, 0], [0, 0, 0], [0, 0, 0], 3), SURFACES);
    expect(noRamp.stepCost(0, 0, 1, 0, CLS)).toBe(-1);
    // Lower cell (x=0, h=0) is a ramp: climbing up allowed.
    const rampLow = createTerrainApi(makeGrid([0, 1, 0], [1, 0, 0], [0, 0, 0], 3), SURFACES);
    expect(rampLow.stepCost(0, 0, 1, 0, CLS)).toBe(10);
    expect(rampLow.stepCost(1, 0, 0, 0, CLS)).toBe(10); // down over same ramp
    // Ramp on the HIGH cell does not help.
    const rampHigh = createTerrainApi(makeGrid([0, 1, 0], [0, 1, 0], [0, 0, 0], 3), SURFACES);
    expect(rampHigh.stepCost(0, 0, 1, 0, CLS)).toBe(-1);
  });

  it('forbids diagonal corner cutting', () => {
    // 2x2: (0,0)->(1,1) diagonal; orthogonal legs (1,0) and (0,1) are rock.
    const api = createTerrainApi(makeGrid([0, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0], 2), SURFACES);
    expect(api.stepCost(0, 0, 1, 1, CLS)).toBe(-1);
  });

  it('charges floorDiv(cost*14,10) for diagonal steps', () => {
    const api = createTerrainApi(makeGrid([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 2), SURFACES);
    expect(api.stepCost(0, 0, 1, 1, CLS)).toBe(14);
  });

  it('rejects steps onto impassable surfaces', () => {
    const api = createTerrainApi(makeGrid([0, 0], [0, 0], [0, 1], 2), SURFACES);
    expect(api.stepCost(0, 0, 1, 0, CLS)).toBe(-1);
    expect(api.passable(1, 0, CLS)).toBe(false);
  });
});

describe('proto_01', () => {
  it('decodes and both enemy points are reachable for ground', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const api = createTerrainApi(map.grid, db.surfaces.list);
    const start = map.points['player_start'];
    expect(start).toBeDefined();
    if (start === undefined) {
      return;
    }
    // BFS over the terrain api using the same rules.
    const seen = new Set<number>([start.y * 96 + start.x]);
    const queue = [start];
    const DIRS = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ] as const;
    while (queue.length > 0) {
      const cur = queue.pop();
      if (cur === undefined) {
        break;
      }
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = ny * 96 + nx;
        if (seen.has(key) || api.stepCost(cur.x, cur.y, nx, ny, CLS) < 0) {
          continue;
        }
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    for (const name of ['enemy_north', 'enemy_east']) {
      const p = map.points[name];
      expect(p, `point ${name}`).toBeDefined();
      if (p !== undefined) {
        expect(seen.has(p.y * 96 + p.x), `${name} reachable`).toBe(true);
      }
    }
  });
});
