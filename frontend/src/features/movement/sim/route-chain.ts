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
  gateLanePoint,
  MAX_GATE_HALF_W,
  releaseRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
  type RouteGate,
} from './route-store';

export {
  boundedLocalRejoin,
  createRouteChainStore,
  releaseRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
};

const CLUSTER_LINK_DIST_SQ = 81; // 9 cells
const GATE_STEP_DIST = 3.0;
const TRACE_SUBSTEP = 0.75;
const MAX_TRACE_STEPS = 360;
const GOAL_CUTOFF_DIST = 6.5;

const lanePt = { x: 0, y: 0 };
const nextLanePt = { x: 0, y: 0 };

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
      (goalCx - cx) * (goalCx - cx) + (goalCy - cy) * (goalCy - cy) <= 64 ||
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
    let nextEmit = 2.5;
    let steps = 0;
    let lastX = px;
    let lastY = py;
    let lastTx = 1;
    let lastTy = 0;

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
        gates.push(buildWideGate(terrain, cls, tier, px, py, tx, ty, prevGate));
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
        gates.push(buildWideGate(terrain, cls, tier, px, py, tx, ty, gates[gates.length - 1]));
        nextEmit = arc + GATE_STEP_DIST;
      }
    }
    if (gates.length === 0 && steps >= 2) {
      gates.push(buildWideGate(terrain, cls, tier, lastX, lastY, lastTx, lastTy));
    }
    for (let k = gates.length - 2; k >= 0; k--) {
      const cur = gates[k];
      const nxt = gates[k + 1];
      if (cur !== undefined && nxt !== undefined) {
        cur.leftW = Math.min(cur.leftW, nxt.leftW + 1.25);
        cur.rightW = Math.min(cur.rightW, nxt.rightW + 1.25);
        cur.halfW = (cur.leftW + cur.rightW) * 0.5;
      }
    }
    const g0 = gates[0];
    if (g0 === undefined) {
      continue;
    }
    let maxAbsLat = 0.5;
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

export function steerRouteFollow(
  store: RouteChainStore,
  terrain: TerrainApi,
  routeOut: RouteFollowView,
  id: number,
  px: number,
  py: number,
  cls: number,
  tier: ClearanceTier,
  outDir: { dx: number; dy: number },
): boolean {
  const chain = store.getChain(routeOut.chain[id] as number);
  if (chain === undefined || chain.gates.length === 0) {
    releaseRouteFollow(store, routeOut, id);
    return false;
  }

  const gates = chain.gates;
  const lane = routeOut.lane[id] as number;
  let k = routeOut.gate[id] as number;

  while (k < gates.length) {
    const gk = gates[k];
    if (gk === undefined) {
      break;
    }
    if (!terrain.passable(gk.ax, gk.ay, cls, tier)) {
      releaseRouteFollow(store, routeOut, id);
      return false;
    }
    gateLanePoint(gk, lane, chain.clusterHalfW, lanePt);
    const wdx = lanePt.x - px;
    const wdy = lanePt.y - py;
    const wDistSq = wdx * wdx + wdy * wdy;
    const along = (px - gk.x) * gk.tx + (py - gk.y) * gk.ty;
    const maxRad = gk.halfW + 2.5;
    if (wDistSq <= 2.25 || (along >= -0.5 && wDistSq <= maxRad * maxRad)) {
      k += 1;
      continue;
    }
    const gNext = gates[k + 1];
    if (gNext !== undefined && along >= -1.25 && wDistSq <= 9 && gNext.halfW >= gk.halfW - 0.5) {
      gateLanePoint(gNext, lane, chain.clusterHalfW, nextLanePt);
      if (lineWalkable(terrain, cls, px, py, nextLanePt.x, nextLanePt.y, tier)) {
        k += 1;
        continue;
      }
    }
    break;
  }

  const gk = gates[k];
  if (k >= gates.length || gk === undefined) {
    releaseRouteFollow(store, routeOut, id);
    return false;
  }
  routeOut.gate[id] = k;
  gateLanePoint(gk, lane, chain.clusterHalfW, lanePt);

  const wdx = lanePt.x - px;
  const wdy = lanePt.y - py;
  if (
    wdx * wdx + wdy * wdy > 1e-6 &&
    terrain.inBounds(Math.floor(lanePt.x), Math.floor(lanePt.y)) &&
    terrain.passable(
      clearanceAnchorCell(lanePt.x, tier),
      clearanceAnchorCell(lanePt.y, tier),
      cls,
      tier,
    ) &&
    lineWalkable(terrain, cls, px, py, lanePt.x, lanePt.y, tier)
  ) {
    outDir.dx = wdx;
    outDir.dy = wdy;
    return true;
  }

  const gdx = gk.x - px;
  const gdy = gk.y - py;
  if (gdx * gdx + gdy * gdy > 1e-6 && lineWalkable(terrain, cls, px, py, gk.x, gk.y, tier)) {
    outDir.dx = gdx;
    outDir.dy = gdy;
    return true;
  }

  if (boundedLocalRejoin(store, terrain, cls, tier, px, py, gk.x, gk.y, outDir)) {
    return true;
  }
  releaseRouteFollow(store, routeOut, id);
  return false;
}
