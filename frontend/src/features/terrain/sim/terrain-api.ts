// Read-only queries over a decoded TerrainGrid plus the resolved surface
// table. All methods are allocation-free — this is the hot path for pathing
// and movement.
import { floorDiv } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { heightStepPassable } from '../rules/index';
import type { TerrainGrid } from '../content';

export interface TerrainApi {
  readonly width: number;
  readonly height: number;
  inBounds(x: number, y: number): boolean;
  heightAt(x: number, y: number): number;
  // Surface registry index at the cell.
  surfaceAt(x: number, y: number): number;
  passable(x: number, y: number, cls: number): boolean;
  // Integer step cost from (ax,ay) to (bx,by) for movement-class index cls;
  // -1 when the step is not allowed.
  stepCost(ax: number, ay: number, bx: number, by: number, cls: number): number;
  speedBpAt(x: number, y: number): number;
}

const DIAGONAL_SCALE_NUM = 14;
const DIAGONAL_SCALE_DEN = 10;

export function createTerrainApi(
  grid: TerrainGrid,
  surfaces: readonly ResolvedSurface[],
): TerrainApi {
  const { width, height } = grid;

  function idx(x: number, y: number): number {
    return y * width + x;
  }

  function costAt(x: number, y: number, cls: number): number {
    const surface = surfaces[grid.surfaces[idx(x, y)] ?? 0];
    return surface?.costs[cls] ?? -1;
  }

  function edgePassable(ax: number, ay: number, bx: number, by: number, cls: number): boolean {
    if (costAt(ax, ay, cls) < 0 || costAt(bx, by, cls) < 0) {
      return false;
    }
    return heightStepPassable(
      grid.heights[idx(ax, ay)] ?? 0,
      grid.heights[idx(bx, by)] ?? 0,
      grid.ramps[idx(ax, ay)] ?? 0,
      grid.ramps[idx(bx, by)] ?? 0,
    );
  }

  return {
    width,
    height,

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < width && y < height;
    },
    heightAt(x, y) {
      return grid.heights[idx(x, y)] ?? 0;
    },
    surfaceAt(x, y) {
      return grid.surfaces[idx(x, y)] ?? 0;
    },
    passable(x, y, cls) {
      return x >= 0 && y >= 0 && x < width && y < height && costAt(x, y, cls) >= 0;
    },
    stepCost(ax, ay, bx, by, cls) {
      if (ax === bx && ay === by) {
        return -1;
      }
      const dx = Math.abs(bx - ax);
      const dy = Math.abs(by - ay);
      if (dx > 1 || dy > 1) {
        return -1;
      }
      if (
        ax < 0 ||
        ay < 0 ||
        bx < 0 ||
        by < 0 ||
        ax >= width ||
        ay >= height ||
        bx >= width ||
        by >= height
      ) {
        return -1;
      }
      if (!edgePassable(ax, ay, bx, by, cls)) {
        return -1;
      }
      const cost = costAt(bx, by, cls);
      if (dx === 1 && dy === 1) {
        // No corner cutting: both orthogonal legs must be passable.
        if (!edgePassable(ax, ay, bx, ay, cls) || !edgePassable(ax, ay, ax, by, cls)) {
          return -1;
        }
        return floorDiv(cost * DIAGONAL_SCALE_NUM, DIAGONAL_SCALE_DEN);
      }
      return cost;
    },
    speedBpAt(x, y) {
      const surface = surfaces[grid.surfaces[idx(x, y)] ?? 0];
      return surface?.speedBp ?? 0;
    },
  };
}
