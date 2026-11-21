import { describe, expect, it } from 'vitest';
import { contentId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { loadContent } from '../../../content/load';
import type { TerrainGrid } from '../content';
import { CLEARANCE_HEAVY, CLEARANCE_STANDARD } from '../rules/index';
import { createTerrainApi } from './terrain-api';

const CLS = 0;

const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
  { id: contentId('a:m'), index: 2, costs: [25], speedBp: 5000, color: '#111111' },
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

describe('TerrainApi heavy clearance (tier = 1)', () => {
  it('rejects a 1-cell gap while allowing a 2-cell corridor', () => {
    // 3x3: walls at y=0 and y=2 except x=0..2 open at y=1 -> 1-cell corridor
    const oneCellGap = createTerrainApi(
      makeGrid(
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 0, 0, 0, 1, 1, 1],
        3,
      ),
      SURFACES,
    );
    expect(oneCellGap.passable(0, 1, CLS, CLEARANCE_STANDARD)).toBe(true);
    expect(oneCellGap.stepCost(0, 1, 1, 1, CLS, CLEARANCE_STANDARD)).toBe(10);
    expect(oneCellGap.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(oneCellGap.passable(0, 1, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(oneCellGap.stepCost(0, 1, 1, 1, CLS, CLEARANCE_HEAVY)).toBe(-1);

    // 3x4: 2-cell wide horizontal corridor at y=1..2
    const twoCellCorridor = createTerrainApi(
      makeGrid(
        new Array<number>(12).fill(0),
        new Array<number>(12).fill(0),
        [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1],
        3,
      ),
      SURFACES,
    );
    expect(twoCellCorridor.passable(0, 1, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(twoCellCorridor.passable(1, 1, CLS, CLEARANCE_HEAVY)).toBe(true);
    // Out-of-bounds 2x2 anchor at x=2 (would need x=3)
    expect(twoCellCorridor.passable(2, 1, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(twoCellCorridor.stepCost(0, 1, 1, 1, CLS, CLEARANCE_HEAVY)).toBe(10);
  });

  it('rejects cliff straddling inside a 2x2 footprint', () => {
    // 2x2: (1,0) is height 1 without ramp, creating an internal cliff edge
    const cliffStraddle = createTerrainApi(
      makeGrid([0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 2),
      SURFACES,
    );
    expect(cliffStraddle.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(cliffStraddle.staticPassable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(false);
  });

  it('allows a 2-wide ramp both up and down and rejects a 1-wide ramp', () => {
    // 4x2: x=0..1 height 0 (x=1 is ramp), x=2..3 height 1
    const twoWideRamp = createTerrainApi(
      makeGrid([0, 0, 1, 1, 0, 0, 1, 1], [0, 1, 0, 0, 0, 1, 0, 0], new Array<number>(8).fill(0), 4),
      SURFACES,
    );
    expect(twoWideRamp.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(twoWideRamp.passable(1, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(twoWideRamp.passable(2, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(twoWideRamp.stepCost(0, 0, 1, 0, CLS, CLEARANCE_HEAVY)).toBe(10);
    expect(twoWideRamp.stepCost(1, 0, 2, 0, CLS, CLEARANCE_HEAVY)).toBe(10);
    // Down over the same 2-wide ramp
    expect(twoWideRamp.stepCost(2, 0, 1, 0, CLS, CLEARANCE_HEAVY)).toBe(10);
    expect(twoWideRamp.stepCost(1, 0, 0, 0, CLS, CLEARANCE_HEAVY)).toBe(10);

    // 1-wide ramp: (1,1) is NOT a ramp, so (1,0) heavy anchor straddles a cliff at y=1
    const oneWideRamp = createTerrainApi(
      makeGrid([0, 0, 1, 1, 0, 0, 1, 1], [0, 1, 0, 0, 0, 0, 0, 0], new Array<number>(8).fill(0), 4),
      SURFACES,
    );
    expect(oneWideRamp.passable(1, 0, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(oneWideRamp.stepCost(0, 0, 1, 0, CLS, CLEARANCE_HEAVY)).toBe(-1);
  });

  it('forbids diagonal corner cutting for tier = 1 and scales open diagonal cost', () => {
    // 3x3 open ground: (0,0) -> (1,1) diagonal heavy move
    const open = createTerrainApi(
      makeGrid(
        new Array<number>(9).fill(0),
        new Array<number>(9).fill(0),
        new Array<number>(9).fill(0),
        3,
      ),
      SURFACES,
    );
    expect(open.stepCost(0, 0, 1, 1, CLS, CLEARANCE_HEAVY)).toBe(14);
    expect(open.stepCost(0, 0, 0, 0, CLS, CLEARANCE_HEAVY)).toBe(-1);
    expect(open.stepCost(0, 0, 2, 0, CLS, CLEARANCE_HEAVY)).toBe(-1);

    // 3x3 with corner rock at (2,0): anchor (1,0) is impassable, blocking diagonal (0,0)->(1,1)
    const cornerRock = createTerrainApi(
      makeGrid(
        new Array<number>(9).fill(0),
        new Array<number>(9).fill(0),
        [0, 0, 1, 0, 0, 0, 0, 0, 0],
        3,
      ),
      SURFACES,
    );
    expect(cornerRock.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(cornerRock.passable(1, 1, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(cornerRock.passable(1, 0, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(cornerRock.stepCost(0, 0, 1, 1, CLS, CLEARANCE_HEAVY)).toBe(-1);
  });

  it('takes the max integer step cost across heterogeneous surfaces', () => {
    // 3x3: cell (2,1) has mud surface (cost 25), others have grass (cost 10)
    const mudPatch = createTerrainApi(
      makeGrid(
        new Array<number>(9).fill(0),
        new Array<number>(9).fill(0),
        [0, 0, 0, 0, 0, 2, 0, 0, 0],
        3,
      ),
      SURFACES,
    );
    // (0,0) -> (1,0): sub-cell (1,1)->(2,1) lands on mud (25), others land on grass (10)
    expect(mudPatch.stepCost(0, 0, 1, 0, CLS, CLEARANCE_HEAVY)).toBe(25);
    // Diagonal (0,0) -> (1,1): sub-cell (1,0)->(2,1) lands on mud -> floorDiv(25*14, 10) = 35
    expect(mudPatch.stepCost(0, 0, 1, 1, CLS, CLEARANCE_HEAVY)).toBe(35);
  });

  it('affects passable and stepCost on dynamic setBlocked(x+1, y+1) without changing staticPassable', () => {
    const api = createTerrainApi(
      makeGrid(
        new Array<number>(9).fill(0),
        new Array<number>(9).fill(0),
        new Array<number>(9).fill(0),
        3,
      ),
      SURFACES,
    );
    expect(api.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(api.staticPassable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(true);

    api.setBlocked([{ x: 1, y: 1 }], true);
    expect(api.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(false);
    expect(api.staticPassable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(api.stepCost(0, 0, 1, 0, CLS, CLEARANCE_HEAVY)).toBe(-1);

    api.setBlocked([{ x: 1, y: 1 }], false);
    expect(api.passable(0, 0, CLS, CLEARANCE_HEAVY)).toBe(true);
    expect(api.stepCost(0, 0, 1, 0, CLS, CLEARANCE_HEAVY)).toBe(10);
  });
});
