// Route helpers: pathing-descent tracing for gather orders, the
// nearest own covered cell for resupply retreats, and retargeting an
// unreachable advance to the nearest reachable hostile structure.
import type { FactionId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction, InWorld } from '../../../kernel/index';
import { Structure } from '../../construction/sim/index';
import type { PathingApi } from '../../pathing/sim/index';
import { spiralOffsets } from '../../terrain/rules/index';
import type { SquadsDeps } from './deps';

const ROUTE_MAX_CELLS = 512;
const RESUPPLY_SEARCH_RADIUS = 64;

// Trace the pathing descent from (sx, sy) toward the goal at (gx, gy)
// for `cls`; returns the polyline (≤ROUTE_MAX_CELLS) or null when the
// start cannot reach the goal. The probe goal is released on return.
export function traceRoute(
  pathing: PathingApi,
  cls: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): number[] | null {
  const goal = pathing.acquireGoal(gx, gy, cls);
  try {
    let x = Math.floor(sx);
    let y = Math.floor(sy);
    if (pathing.directionAt(goal, x, y) === null) {
      return null;
    }
    const route: number[] = [];
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    let guard = 0;
    while ((x !== tx || y !== ty) && route.length < ROUTE_MAX_CELLS) {
      route.push(x, y);
      const d = pathing.directionAt(goal, x, y);
      if (d === null || (d.dx === 0 && d.dy === 0)) {
        break;
      }
      x += d.dx;
      y += d.dy;
      guard += 1;
      if (guard > ROUTE_MAX_CELLS) {
        break;
      }
    }
    route.push(x, y);
    return route;
  } finally {
    pathing.releaseGoal(goal);
  }
}

// Nearest own-faction covered cell within the search radius (spiral),
// or null when none — used for the resupply retreat point.
export function nearestCovered(
  ctx: SystemContext,
  deps: SquadsDeps,
  faction: FactionId,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  for (const [dx, dy] of spiralOffsets(ix, iy, deps.terrain.width, deps.terrain.height)) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) > RESUPPLY_SEARCH_RADIUS) {
      break;
    }
    if (deps.logistics.covered(ctx, faction, ix + dx + 0.5, iy + dy + 0.5)) {
      return { x: ix + dx + 0.5, y: iy + dy + 0.5 };
    }
  }
  return null;
}

// Fixed neighbour expansion order (cardinals first, then diagonals) —
// BFS results must not depend on iteration order of a Map.
const BFS_DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
// The retarget search never looks farther than this Chebyshev radius.
const RETARGET_RADIUS = 96;

// Retarget an unreachable advance to the nearest reachable hostile
// structure (symmetric rule for every faction): one bounded BFS from
// the centroid cell over cells the class can step to (stepCost honours
// the dynamic blocked overlay and no-corner-cut), stopping at the
// first passable cell adjacent to a hostile structure footprint.
// Sites count as structures; blueprints are not InWorld. Returns the
// adjacent cell's centre or null when nothing is reachable.
export function retargetStructure(
  ctx: SystemContext,
  deps: SquadsDeps,
  faction: FactionId,
  cls: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const st = ctx.read(Structure);
  const fac = ctx.read(Faction);
  const terrain = deps.terrain;
  const width = terrain.width;
  // Hostile structure footprint cells.
  const foot = new Set<number>();
  // Ruins carry no Faction: requiring it here keeps recycled-id faction
  // reads safe (ADR 0040) and keeps ruins out of the hostile set.
  for (const id of ctx.query([Structure, Faction, InWorld])) {
    if (!ctx.isHostile(faction, (fac.id[id] ?? 0) as FactionId)) {
      continue;
    }
    const kind = deps.db.structures.byIndex(st.kind[id] ?? 0);
    const fx = st.x[id] ?? 0;
    const fy = st.y[id] ?? 0;
    for (let y = 0; y < (kind?.footprint.h ?? 1); y++) {
      for (let x = 0; x < (kind?.footprint.w ?? 1); x++) {
        foot.add((fy + y) * width + fx + x);
      }
    }
  }
  if (foot.size === 0) {
    return null;
  }
  const sx = Math.floor(cx);
  const sy = Math.floor(cy);
  const start = sy * width + sx;
  if (!terrain.passable(sx, sy, cls)) {
    return null;
  }
  const visited = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] ?? 0;
    const x = cell % width;
    const y = Math.floor(cell / width);
    // A footprint cell in the 8-neighbourhood makes this a goal cell.
    let adjacent = false;
    for (let dy = -1; dy <= 1 && !adjacent; dy++) {
      for (let dx = -1; dx <= 1 && !adjacent; dx++) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        if (foot.has((y + dy) * width + x + dx)) {
          adjacent = true;
        }
      }
    }
    if (adjacent) {
      return { x: x + 0.5, y: y + 0.5 };
    }
    for (const [dx, dy] of BFS_DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (Math.abs(nx - sx) > RETARGET_RADIUS || Math.abs(ny - sy) > RETARGET_RADIUS) {
        continue;
      }
      const ni = ny * width + nx;
      if (visited.has(ni) || terrain.stepCost(x, y, nx, ny, cls) < 0) {
        continue;
      }
      visited.add(ni);
      queue.push(ni);
    }
  }
  return null;
}
