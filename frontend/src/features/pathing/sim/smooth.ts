// Wall-parallel one-sided upwind gradient fallback (Stage 2b) when units
// hug cliff edges or narrow 2-cell corridors where bilateral quads fail.
// Pure deterministic math only (ADR 0006 purity zone).
import type { ClearanceTier } from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { DIR_E, DIR_N, DIR_S, DIR_W, type SlotCache } from './grid-cache';

// Wall-edge deadband inside a cell: directions into a wall are zeroed only
// while the sub-cell position sits inside these margins.
const EDGE_LOCK_MIN = 0.35;
const EDGE_LOCK_MAX = 0.65;

export function wallParallelDirection(
  terrain: TerrainApi,
  sc: SlotCache,
  u: Int32Array,
  inf: number,
  cls: number,
  tier: ClearanceTier,
  isHeavy: boolean,
  px: number,
  py: number,
  cx: number,
  cy: number,
  d0x: number,
  d0y: number,
  costAt: (x: number, y: number) => number,
  out: { dx: number; dy: number },
): boolean {
  const width = terrain.width;
  const height = terrain.height;
  if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
    return false;
  }
  const cIdx = cy * width + cx;
  const here = u[cIdx] ?? inf;
  const mask = sc.dirMask[cIdx] ?? 0;
  const wOk = (mask & DIR_W) !== 0 && cx > 0;
  const eOk = (mask & DIR_E) !== 0 && cx + 1 < width;
  const nOk = (mask & DIR_N) !== 0 && cy > 0;
  const sOk = (mask & DIR_S) !== 0 && cy + 1 < height;
  const cW = wOk ? costAt(cx - 1, cy) : inf;
  const cE = eOk ? costAt(cx + 1, cy) : inf;
  const cN = nOk ? costAt(cx, cy - 1) : inf;
  const cS = sOk ? costAt(cx, cy + 1) : inf;
  const wValid = cW < inf;
  const eValid = cE < inf;
  const nValid = cN < inf;
  const sValid = cS < inf;
  let gx =
    wValid && eValid
      ? (cW - cE) * 0.5
      : eValid
        ? Math.max(0, here - cE)
        : wValid
          ? Math.min(0, cW - here)
          : 0;
  let gy =
    nValid && sValid
      ? (cN - cS) * 0.5
      : sValid
        ? Math.max(0, here - cS)
        : nValid
          ? Math.min(0, cN - here)
          : 0;
  // Sub-cell position within the anchor cell; directions pointing into a
  // wall are locked out when the unit sits beyond these edges.
  const shift = isHeavy ? 0.5 : 0;
  const fx = px - (cx + shift);
  const fy = py - (cy + shift);
  if (!wValid && fx < EDGE_LOCK_MIN && gx < 0) {
    gx = 0;
  }
  if (!eValid && fx > EDGE_LOCK_MAX && gx > 0) {
    gx = 0;
  }
  if (!nValid && fy < EDGE_LOCK_MIN && gy < 0) {
    gy = 0;
  }
  if (!sValid && fy > EDGE_LOCK_MAX && gy > 0) {
    gy = 0;
  }
  let sx = gx > 0 ? 1 : gx < 0 ? -1 : 0;
  let sy = gy > 0 ? 1 : gy < 0 ? -1 : 0;
  if (
    sx !== 0 &&
    sy !== 0 &&
    (terrain.stepCost(cx, cy, cx + sx, cy + sy, cls, tier) < 0 || costAt(cx + sx, cy + sy) >= here)
  ) {
    if (Math.abs(gx) >= Math.abs(gy)) {
      gy = 0;
      sy = 0;
    } else {
      gx = 0;
      sx = 0;
    }
  }
  if (
    (sx !== 0 || sy !== 0) &&
    gx * d0x + gy * d0y > 0 &&
    terrain.stepCost(cx, cy, cx + sx, cy + sy, cls, tier) >= 0 &&
    costAt(cx + sx, cy + sy) < here
  ) {
    const len = Math.sqrt(gx * gx + gy * gy);
    if (len > 0) {
      out.dx = gx / len;
      out.dy = gy / len;
      return true;
    }
  }
  return false;
}
