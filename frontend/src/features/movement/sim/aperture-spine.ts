// Pure spatial aperture spine following (ADR 0059): C1 corridor width
// narrowing/widening + V-wedge wing tuck without any per-chain speed cap.
// Pure deterministic math (ADR 0006 purity zone), zero allocations per tick.
import { clearanceAnchorCell, type ClearanceTier } from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { canStep, lineWalkable } from './line';
import {
  boundedLocalRejoin,
  releaseRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
} from './route-store';

export function steerApertureSpine(
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
  const maxIdx = gates.length - 1;
  let k = Math.min(maxIdx, routeOut.gate[id] as number);

  // Dynamic blocker guard: release promptly so smooth flow field reroutes on obstacle changes.
  const checkEnd = Math.min(maxIdx, k + 10);
  for (let c = k; c <= checkEnd; c++) {
    const gc = gates[c];
    if (gc !== undefined && !terrain.passable(gc.ax, gc.ay, cls, tier)) {
      releaseRouteFollow(store, routeOut, id);
      return false;
    }
  }

  const lane = routeOut.lane[id] as number;
  while (k < maxIdx) {
    const gNxt = gates[k + 1];
    if (gNxt === undefined) {
      break;
    }
    if ((px - gNxt.x) * gNxt.tx + (py - gNxt.y) * gNxt.ty >= 0) {
      k += 1;
      continue;
    }
    const sideW = lane >= 0 ? gNxt.rightW : gNxt.leftW;
    const effHW = chain.clusterHalfW * gNxt.aperture;
    const lat = lane * (effHW < sideW ? effHW : sideW);
    const ldx = px - (gNxt.x + gNxt.nx * lat);
    const ldy = py - (gNxt.y + gNxt.ny * lat);
    if (ldx * ldx + ldy * ldy <= 5.0625) {
      k += 1;
      continue;
    }
    break;
  }
  while (k > 0) {
    const gCur = gates[k];
    if (gCur === undefined || (px - gCur.x) * gCur.tx + (py - gCur.y) * gCur.ty >= -0.5) {
      break;
    }
    const sideW = lane >= 0 ? gCur.rightW : gCur.leftW;
    const effHW = chain.clusterHalfW * gCur.aperture;
    const lat = lane * (effHW < sideW ? effHW : sideW);
    const ldx = px - (gCur.x + gCur.nx * lat);
    const ldy = py - (gCur.y + gCur.ny * lat);
    if (ldx * ldx + ldy * ldy <= 5.0625) {
      break;
    }
    k -= 1;
  }
  routeOut.gate[id] = k;

  const gLo = gates[k];
  if (gLo === undefined) {
    releaseRouteFollow(store, routeOut, id);
    return false;
  }
  const gHi = k < maxIdx ? gates[k + 1] : undefined;
  let unitArc: number;
  let curAp: number;
  if (gHi !== undefined) {
    const segX = gHi.x - gLo.x;
    const segY = gHi.y - gLo.y;
    const segLenSq = segX * segX + segY * segY;
    const tSeg =
      segLenSq > 1e-8
        ? Math.max(0, Math.min(1, ((px - gLo.x) * segX + (py - gLo.y) * segY) / segLenSq))
        : 0;
    unitArc = gLo.arc + (gHi.arc - gLo.arc) * tSeg;
    curAp = gLo.aperture + (gHi.aperture - gLo.aperture) * tSeg;
  } else {
    unitArc = gLo.arc;
    curAp = gLo.aperture;
  }

  const gEnd = gates[maxIdx];
  let atEndLane = false;
  if (gEnd !== undefined && k >= maxIdx - 1) {
    const endSideW = lane >= 0 ? gEnd.rightW : gEnd.leftW;
    const endHW = chain.clusterHalfW * gEnd.aperture;
    const endLat = lane * (endHW < endSideW ? endHW : endSideW);
    const edx = px - (gEnd.x + gEnd.nx * endLat);
    const edy = py - (gEnd.y + gEnd.ny * endLat);
    atEndLane = edx * edx + edy * edy <= 7.84;
  }
  if (
    atEndLane ||
    unitArc >= chain.totalArc - 1.2 ||
    (gEnd !== undefined &&
      k >= maxIdx &&
      (px - gEnd.x) * gEnd.tx + (py - gEnd.y) * gEnd.ty >= -0.35) ||
    (gEnd !== undefined &&
      unitArc >= chain.totalArc - 2.5 &&
      (px - gEnd.x) * (px - gEnd.x) + (py - gEnd.y) * (py - gEnd.y) <=
        (gEnd.halfW + 2.2) * (gEnd.halfW + 2.2))
  ) {
    releaseRouteFollow(store, routeOut, id);
    return false;
  }

  const lookAhead = 2.1 - Math.abs(lane) * (1 - curAp) * 0.75;
  const lookArc = Math.min(chain.totalArc, unitArc + lookAhead);

  let b = k;
  while (b < maxIdx - 1 && (gates[b + 1]?.arc ?? chain.totalArc) < lookArc) {
    b += 1;
  }
  while (b > 0 && (gates[b]?.arc ?? 0) > lookArc) {
    b -= 1;
  }

  const ga = gates[b];
  const gb = b < maxIdx ? gates[b + 1] : undefined;
  let sx: number;
  let sy: number;
  let stx: number;
  let sty: number;
  let snx: number;
  let sny: number;
  let sLeftW: number;
  let sRightW: number;
  let sAp: number;
  if (ga !== undefined && gb !== undefined && gb.arc > ga.arc + 1e-6) {
    const f = Math.max(0, Math.min(1, (lookArc - ga.arc) / (gb.arc - ga.arc)));
    sx = ga.x + (gb.x - ga.x) * f;
    sy = ga.y + (gb.y - ga.y) * f;
    const rawTx = ga.tx + (gb.tx - ga.tx) * f;
    const rawTy = ga.ty + (gb.ty - ga.ty) * f;
    const tLen = Math.sqrt(rawTx * rawTx + rawTy * rawTy);
    stx = tLen > 1e-6 ? rawTx / tLen : ga.tx;
    sty = tLen > 1e-6 ? rawTy / tLen : ga.ty;
    const rawNx = ga.nx + (gb.nx - ga.nx) * f;
    const rawNy = ga.ny + (gb.ny - ga.ny) * f;
    const nLen = Math.sqrt(rawNx * rawNx + rawNy * rawNy);
    snx = nLen > 1e-6 ? rawNx / nLen : ga.nx;
    sny = nLen > 1e-6 ? rawNy / nLen : ga.ny;
    sLeftW = ga.leftW + (gb.leftW - ga.leftW) * f;
    sRightW = ga.rightW + (gb.rightW - ga.rightW) * f;
    sAp = ga.aperture + (gb.aperture - ga.aperture) * f;
  } else {
    const gOnly = ga ?? gLo;
    sx = gOnly.x;
    sy = gOnly.y;
    stx = gOnly.tx;
    sty = gOnly.ty;
    snx = gOnly.nx;
    sny = gOnly.ny;
    sLeftW = gOnly.leftW;
    sRightW = gOnly.rightW;
    sAp = gOnly.aperture;
  }

  const effHalfW = chain.clusterHalfW * sAp;
  const sideW = lane >= 0 ? sRightW : sLeftW;
  const latOff = lane * (effHalfW < sideW ? effHalfW : sideW);
  const tx = sx + snx * latOff;
  const ty = sy + sny * latOff;

  const wdx = tx - px;
  const wdy = ty - py;
  const wLenSq = wdx * wdx + wdy * wdy;
  if (
    wLenSq > 1e-6 &&
    terrain.inBounds(Math.floor(tx), Math.floor(ty)) &&
    terrain.passable(clearanceAnchorCell(tx, tier), clearanceAnchorCell(ty, tier), cls, tier) &&
    lineWalkable(terrain, cls, px, py, tx, ty, tier)
  ) {
    const wLen = Math.sqrt(wLenSq);
    const lx = wdx / wLen;
    const ly = wdy / wLen;
    const latErr = Math.abs((px - sx) * snx + (py - sy) * sny - latOff);
    const wLane = Math.min(0.85, 0.55 + latErr * 0.3);
    const bx = lx * wLane + stx * (1 - wLane);
    const by = ly * wLane + sty * (1 - wLane);
    const bLen = Math.sqrt(bx * bx + by * by);
    if (bLen > 1e-6) {
      const ux = bx / bLen;
      const uy = by / bLen;
      const probeX = px + ux * 0.6;
      const probeY = py + uy * 0.6;
      if (
        terrain.inBounds(Math.floor(probeX), Math.floor(probeY)) &&
        terrain.passable(
          clearanceAnchorCell(probeX, tier),
          clearanceAnchorCell(probeY, tier),
          cls,
          tier,
        ) &&
        canStep(
          terrain,
          cls,
          tier,
          clearanceAnchorCell(px, tier),
          clearanceAnchorCell(py, tier),
          probeX,
          probeY,
        )
      ) {
        outDir.dx = ux;
        outDir.dy = uy;
        return true;
      }
    }
    outDir.dx = lx;
    outDir.dy = ly;
    return true;
  }

  const cdx = sx - px;
  const cdy = sy - py;
  if (
    cdx * cdx + cdy * cdy > 1e-6 &&
    terrain.inBounds(Math.floor(sx), Math.floor(sy)) &&
    terrain.passable(clearanceAnchorCell(sx, tier), clearanceAnchorCell(sy, tier), cls, tier) &&
    lineWalkable(terrain, cls, px, py, sx, sy, tier)
  ) {
    outDir.dx = cdx;
    outDir.dy = cdy;
    return true;
  }

  const gJoin = gates[Math.min(maxIdx, k + 1)] ?? gLo;
  if (boundedLocalRejoin(store, terrain, cls, tier, px, py, gJoin.x, gJoin.y, outDir)) {
    return true;
  }
  releaseRouteFollow(store, routeOut, id);
  return false;
}
