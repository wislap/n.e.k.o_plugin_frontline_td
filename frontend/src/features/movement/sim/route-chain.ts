// Spatial clustering + shared topological wide-gate corridor chains (ADR 0056).
// Pure deterministic math only (ADR 0006 purity zone): rides on the single
// shared MoveTarget PathingApi goal without acquiring extra flow fields.
import type { ReadonlyNumberArray } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import {
  clearanceAnchorCell,
  clearanceAnchorCenter,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { lineWalkable } from './line';
import {
  boundedLocalRejoin,
  buildWideGate,
  createRouteChainStore,
  GATE_CLEAR_INSET,
  MAX_GATE_HALF_W,
  releaseRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
  type RouteGate,
} from './route-store';
import { steerApertureSpine } from './aperture-spine';

export {
  boundedLocalRejoin,
  createRouteChainStore,
  releaseRouteFollow,
  steerApertureSpine as steerRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
};

const CLUSTER_LINK_DIST_SQ = 81; // 9 cells
const GATE_STEP_DIST = 1.5;
const TRACE_SUBSTEP = 0.5;
const MAX_TRACE_STEPS = 540;
const GOAL_CUTOFF_DIST = 4.5;
// Representative swap falls back to "any member near the goal" inside this
// squared distance.
const GOAL_SWAP_DIST_SQ = 64; // 8 cells
// Minimum arc distance between successive corridor gates.
const GATE_MIN_ARC_GAP = 0.5;
// Per-gate width propagation margin walking backward through the chain.
const GATE_WIDTH_GROWTH = 0.7;
// Floor for the lateral cluster half-width before member offsets apply.
const LANE_LAT_FLOOR = 0.5;
// Aperture lookahead: narrowest gate within this arc distance sets the
// profile, smoothed twice with a binomial kernel so morphing never kinks.
const APERTURE_LOOKAHEAD = 4.5;
const APERTURE_DENOM_FLOOR = 0.8;
const APERTURE_MIN = 0.22;
const APERTURE_SMOOTH_SIDE = 0.25;
const APERTURE_SMOOTH_CENTER = 0.5;

function clusterOpenGroundSkip(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  cluster: readonly number[],
  ux: Float64Array,
  uy: Float64Array,
  repIdx: number,
  goalCx: number,
  goalCy: number,
  clsIds: readonly number[],
  slotMap: ReadonlyMap<number, { x: number; y: number }>,
  fallback: { x: number; y: number },
): boolean {
  if (
    !lineWalkable(terrain, cls, ux[repIdx] as number, uy[repIdx] as number, goalCx, goalCy, tier)
  ) {
    return false;
  }
  const exIdx = [0, 0, 0, 0, 0, 0, 0, 0];
  let sampleCount = cluster.length;
  if (cluster.length > 8) {
    sampleCount = 8;
    const bestVal = [
      Infinity,
      -Infinity,
      Infinity,
      -Infinity,
      Infinity,
      -Infinity,
      Infinity,
      -Infinity,
    ];
    for (let k = 0; k < cluster.length; k++) {
      const idx = cluster[k] as number;
      const x = ux[idx] as number;
      const y = uy[idx] as number;
      const keys = [x, x, y, y, x + y, x + y, x - y, x - y];
      for (let e = 0; e < 8; e++) {
        const kv = keys[e] as number;
        const bv = bestVal[e] as number;
        if (e % 2 === 0 ? kv < bv : kv > bv) {
          bestVal[e] = kv;
          exIdx[e] = idx;
        }
      }
    }
  }
  for (let k = 0; k < sampleCount; k++) {
    const idx = (cluster.length <= 8 ? cluster[k] : exIdx[k]) as number;
    const dest = slotMap.get(clsIds[idx] as number) ?? fallback;
    if (!lineWalkable(terrain, cls, ux[idx] as number, uy[idx] as number, dest.x, dest.y, tier)) {
      return false;
    }
  }
  return true;
}

export function assignClusterRoutes(
  store: RouteChainStore,
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  routeOut: RouteFollowView,
  clsIds: readonly number[],
  cls: number,
  tier: ClearanceTier,
  goalId: number,
  goalX: number,
  goalY: number,
  slotMap: ReadonlyMap<number, { x: number; y: number }>,
  fallback: { x: number; y: number },
): void {
  const n = clsIds.length;
  for (let i = 0; i < n; i++) {
    releaseRouteFollow(store, routeOut, clsIds[i] as number);
  }
  if (n < 2) {
    return;
  }

  const ux = new Float64Array(n);
  const uy = new Float64Array(n);
  const uax = new Int32Array(n);
  const uay = new Int32Array(n);
  const rem = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const id = clsIds[i] as number;
    const px = pos.x[id] ?? 0;
    const py = pos.y[id] ?? 0;
    ux[i] = px;
    uy[i] = py;
    uax[i] = clearanceAnchorCell(px, tier);
    uay[i] = clearanceAnchorCell(py, tier);
    rem[i] = i;
  }

  const goalCx = clearanceAnchorCenter(goalX, tier);
  const goalCy = clearanceAnchorCenter(goalY, tier);
  let remCount = n;

  while (remCount > 0) {
    const cluster: number[] = [rem[--remCount] as number];
    for (let head = 0; head < cluster.length; head++) {
      const i = cluster[head] as number;
      const ix = ux[i] as number;
      const iy = uy[i] as number;
      const iax = uax[i] as number;
      const iay = uay[i] as number;
      let jPos = 0;
      while (jPos < remCount) {
        const j = rem[jPos] as number;
        const dx = (ux[j] as number) - ix;
        const dy = (uy[j] as number) - iy;
        if (
          dx * dx + dy * dy <= CLUSTER_LINK_DIST_SQ &&
          (((uax[j] as number) === iax && (uay[j] as number) === iay) ||
            lineWalkable(terrain, cls, ix, iy, ux[j] as number, uy[j] as number, tier))
        ) {
          cluster.push(j);
          rem[jPos] = rem[--remCount] as number;
        } else {
          jPos += 1;
        }
      }
    }
    if (cluster.length < 2) {
      continue;
    }
    cluster.sort((a, b) => a - b);

    let sumX = 0;
    let sumY = 0;
    for (let k = 0; k < cluster.length; k++) {
      const idx = cluster[k] as number;
      sumX += ux[idx] as number;
      sumY += uy[idx] as number;
    }
    const cx = sumX / cluster.length;
    const cy = sumY / cluster.length;

    let repIdx = -1;
    let repDistSq = Infinity;
    for (let k = 0; k < cluster.length; k++) {
      const idx = cluster[k] as number;
      if (pathing.directionAt(goalId, uax[idx] as number, uay[idx] as number) === null) {
        continue;
      }
      const dx = (ux[idx] as number) - cx;
      const dy = (uy[idx] as number) - cy;
      if (dx * dx + dy * dy < repDistSq) {
        repDistSq = dx * dx + dy * dy;
        repIdx = idx;
      }
    }
    if (
      repIdx === -1 ||
      (goalCx - cx) * (goalCx - cx) + (goalCy - cy) * (goalCy - cy) <= GOAL_SWAP_DIST_SQ ||
      clusterOpenGroundSkip(
        terrain,
        cls,
        tier,
        cluster,
        ux,
        uy,
        repIdx,
        goalCx,
        goalCy,
        clsIds,
        slotMap,
        fallback,
      )
    ) {
      continue;
    }

    const gates: RouteGate[] = [];
    let px = ux[repIdx] as number;
    let py = uy[repIdx] as number;
    let arc = 0;
    let nextEmit = GATE_STEP_DIST;
    let steps = 0;
    let lastX = px;
    let lastY = py;
    let lastTx = 1;
    let lastTy = 0;
    const d0 = pathing.smoothDirectionAt(goalId, px, py);
    const d0Len = d0 === null ? 0 : Math.sqrt(d0.dx * d0.dx + d0.dy * d0.dy);
    if (d0 !== null && d0Len > 1e-9) {
      lastTx = d0.dx / d0Len;
      lastTy = d0.dy / d0Len;
      gates.push(buildWideGate(terrain, cls, tier, px, py, lastTx, lastTy, 0));
    }

    for (let step = 0; step < MAX_TRACE_STEPS; step++) {
      const gdx = goalCx - px;
      const gdy = goalCy - py;
      if (gdx * gdx + gdy * gdy <= GOAL_CUTOFF_DIST * GOAL_CUTOFF_DIST) {
        break;
      }
      const dir = pathing.smoothDirectionAt(goalId, px, py);
      const dLen = dir === null ? 0 : Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
      if (dir === null || dLen <= 1e-9) {
        break;
      }
      const tx = dir.dx / dLen;
      const ty = dir.dy / dLen;
      const nxPos = px + tx * TRACE_SUBSTEP;
      const nyPos = py + ty * TRACE_SUBSTEP;
      if (
        !terrain.inBounds(Math.floor(nxPos), Math.floor(nyPos)) ||
        !terrain.passable(
          clearanceAnchorCell(nxPos, tier),
          clearanceAnchorCell(nyPos, tier),
          cls,
          tier,
        )
      ) {
        break;
      }
      const prevGate = gates[gates.length - 1];
      if (
        prevGate !== undefined &&
        !lineWalkable(terrain, cls, prevGate.x, prevGate.y, nxPos, nyPos, tier) &&
        (px !== prevGate.x || py !== prevGate.y)
      ) {
        gates.push(buildWideGate(terrain, cls, tier, px, py, tx, ty, arc, prevGate));
        nextEmit = arc + GATE_STEP_DIST;
      }
      px = nxPos;
      py = nyPos;
      arc += TRACE_SUBSTEP;
      steps += 1;
      lastX = px;
      lastY = py;
      lastTx = tx;
      lastTy = ty;
      if (arc >= nextEmit) {
        gates.push(buildWideGate(terrain, cls, tier, px, py, tx, ty, arc, gates[gates.length - 1]));
        nextEmit = arc + GATE_STEP_DIST;
      }
    }
    const lastGate = gates[gates.length - 1];
    if (gates.length === 0 && steps >= 2) {
      gates.push(buildWideGate(terrain, cls, tier, lastX, lastY, lastTx, lastTy, arc));
    } else if (lastGate !== undefined && arc > lastGate.arc + GATE_MIN_ARC_GAP) {
      gates.push(buildWideGate(terrain, cls, tier, lastX, lastY, lastTx, lastTy, arc, lastGate));
    }
    for (let k = gates.length - 2; k >= 0; k--) {
      const cur = gates[k];
      const nxt = gates[k + 1];
      if (cur !== undefined && nxt !== undefined) {
        cur.leftW = Math.min(cur.leftW, nxt.leftW + GATE_WIDTH_GROWTH);
        cur.rightW = Math.min(cur.rightW, nxt.rightW + GATE_WIDTH_GROWTH);
        cur.halfW = (cur.leftW + cur.rightW) * 0.5;
      }
    }
    const g0 = gates[0];
    if (g0 === undefined) {
      continue;
    }
    let maxAbsLat = LANE_LAT_FLOOR;
    const lats = new Float64Array(cluster.length);
    for (let k = 0; k < cluster.length; k++) {
      const idx = cluster[k] as number;
      const lat = ((ux[idx] as number) - cx) * g0.nx + ((uy[idx] as number) - cy) * g0.ny;
      lats[k] = lat;
      if (Math.abs(lat) > maxAbsLat) {
        maxAbsLat = Math.abs(lat);
      }
    }
    const clusterHalfW = Math.min(MAX_GATE_HALF_W, maxAbsLat);
    // Bake lookahead aperture profile (0.22..1.0) and C1-smooth twice so column morphing never kinks.
    const gLen = gates.length;
    const denom = Math.max(APERTURE_DENOM_FLOOR, clusterHalfW);
    let rawAp = new Float64Array(gLen);
    let smoothAp = new Float64Array(gLen);
    for (let i = 0; i < gLen; i++) {
      const gi = gates[i];
      if (gi === undefined) {
        continue;
      }
      const lookEnd = gi.arc + APERTURE_LOOKAHEAD;
      let minHalfW = clusterHalfW;
      for (let j = i; j < gLen; j++) {
        const gj = gates[j];
        if (gj === undefined || gj.arc > lookEnd) {
          break;
        }
        if (gj.halfW < minHalfW) {
          minHalfW = gj.halfW;
        }
      }
      rawAp[i] = Math.max(APERTURE_MIN, Math.min(1, (minHalfW - GATE_CLEAR_INSET) / denom));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < gLen; i++) {
        const prev = rawAp[i > 0 ? i - 1 : i] as number;
        const cur = rawAp[i] as number;
        const next = rawAp[i + 1 < gLen ? i + 1 : i] as number;
        smoothAp[i] =
          APERTURE_SMOOTH_SIDE * prev + APERTURE_SMOOTH_CENTER * cur + APERTURE_SMOOTH_SIDE * next;
      }
      const tmp = rawAp;
      rawAp = smoothAp;
      smoothAp = tmp;
    }
    for (let i = 0; i < gLen; i++) {
      const gi = gates[i];
      if (gi !== undefined) {
        gi.aperture = rawAp[i] ?? 1;
      }
    }

    const chainId = store.acquireChain(cls, tier, clusterHalfW, gates, cluster.length);
    for (let k = 0; k < cluster.length; k++) {
      const id = clsIds[cluster[k] as number] as number;
      routeOut.chain[id] = chainId;
      routeOut.gate[id] = 0;
      routeOut.lane[id] = Math.max(-1, Math.min(1, (lats[k] as number) / maxAbsLat));
      routeOut.active[id] = 1;
    }
  }
}
