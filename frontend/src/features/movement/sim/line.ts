// Supercover continuous sub-cell grid line walk between two world points:
// the straight segment may be steered directly only when every cell-to-cell
// step along it is legal for the movement class (stepCost >= 0; stepCost
// already enforces no corner cutting on diagonals).
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';

export function canStep(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  ccx: number,
  ccy: number,
  tx: number,
  ty: number,
): boolean {
  const tcx = clearanceAnchorCell(tx, tier);
  const tcy = clearanceAnchorCell(ty, tier);
  return (tcx === ccx && tcy === ccy) || terrain.stepCost(ccx, ccy, tcx, tcy, cls, tier) >= 0;
}

export function lineWalkable(
  terrain: TerrainApi,
  cls: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tier: ClearanceTier = CLEARANCE_STANDARD,
): boolean {
  let cx = clearanceAnchorCell(x0, tier);
  let cy = clearanceAnchorCell(y0, tier);
  const ex = clearanceAnchorCell(x1, tier);
  const ey = clearanceAnchorCell(y1, tier);
  if (cx === ex && cy === ey) {
    return true;
  }
  const shift = tier === CLEARANCE_HEAVY ? 0.5 : 0;
  const u0 = x0 - shift;
  const v0 = y0 - shift;
  const u1 = x1 - shift;
  const v1 = y1 - shift;
  const sx = ex > cx ? 1 : ex < cx ? -1 : 0;
  const sy = ey > cy ? 1 : ey < cy ? -1 : 0;
  const adx = Math.abs(u1 - u0);
  const ady = Math.abs(v1 - v0);
  const firstX = sx > 0 ? cx + 1 - u0 : u0 - cx;
  const firstY = sy > 0 ? cy + 1 - v0 : v0 - cy;
  let tMaxX = sx === 0 || adx === 0 ? Infinity : Math.max(0, firstX) / adx;
  let tMaxY = sy === 0 || ady === 0 ? Infinity : Math.max(0, firstY) / ady;
  const tDeltaX = sx === 0 || adx === 0 ? Infinity : 1 / adx;
  const tDeltaY = sy === 0 || ady === 0 ? Infinity : 1 / ady;
  while (cx !== ex || cy !== ey) {
    let nx = cx;
    let ny = cy;
    const canX = cx !== ex;
    const canY = cy !== ey;
    if (canX && canY && Math.abs(tMaxX - tMaxY) <= 1e-12) {
      nx += sx;
      ny += sy;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (canX && (!canY || tMaxX <= tMaxY)) {
      nx += sx;
      tMaxX += tDeltaX;
    } else {
      ny += sy;
      tMaxY += tDeltaY;
    }
    if (terrain.stepCost(cx, cy, nx, ny, cls, tier) < 0) {
      return false;
    }
    cx = nx;
    cy = ny;
  }
  return true;
}
