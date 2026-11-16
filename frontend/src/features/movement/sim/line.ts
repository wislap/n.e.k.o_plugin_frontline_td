// Supercover grid line walk between two cells: the straight line may be
// steered directly only when every cell-to-cell step along it is legal for
// the movement class (stepCost >= 0; stepCost already enforces no corner
// cutting on diagonals). Positions are floored to their cells.
import type { TerrainApi } from '../../terrain/sim/index';

export function lineWalkable(
  terrain: TerrainApi,
  cls: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const sx = Math.sign(ex - cx);
  const sy = Math.sign(ey - cy);
  const adx = Math.abs(ex - cx);
  const ady = Math.abs(ey - cy);
  // Amanatides–Woo DDA between cell centres: tMax is the param of the next
  // boundary crossing per axis, tDelta the param step between crossings.
  let tMaxX = adx === 0 ? Infinity : 0.5 / adx;
  let tMaxY = ady === 0 ? Infinity : 0.5 / ady;
  const tDeltaX = adx === 0 ? Infinity : 1 / adx;
  const tDeltaY = ady === 0 ? Infinity : 1 / ady;
  while (cx !== ex || cy !== ey) {
    let nx = cx;
    let ny = cy;
    if (tMaxX < tMaxY) {
      nx += sx;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      ny += sy;
      tMaxY += tDeltaY;
    } else {
      // Exact corner crossing: step diagonally; stepCost rejects the move
      // when either orthogonal leg is impassable.
      nx += sx;
      ny += sy;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    if (terrain.stepCost(cx, cy, nx, ny, cls) < 0) {
      return false;
    }
    cx = nx;
    cy = ny;
  }
  return true;
}
