// RouteChain pool/serialization + wide-gate geometry and bounded local rejoin
// helpers (ADR 0056). Pure deterministic math (ADR 0006 purity zone).
import type { Serializable } from '../../../core/index';
import type { WriteView } from '../../../kernel/index';
import { DIR_ORDER } from '../../pathing/sim/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { lineWalkable } from './line';

const STD_TIER = CLEARANCE_STANDARD;
const HEAVY_TIER = CLEARANCE_HEAVY;
const DIRS = DIR_ORDER;

export const MAX_GATE_HALF_W = 4.5;
const LOCAL_REJOIN_RADIUS = 12;
const BFS_WIN = LOCAL_REJOIN_RADIUS * 2 + 1;

const bfsQueue = new Int32Array(729);
const bfsFirstDir = new Int8Array(729);
const bfsSeen = new Int32Array(729);
let bfsStamp = 1;

export type RouteFollowView = WriteView<{ chain: 'u32'; gate: 'u16'; lane: 'f64'; active: 'u8' }>;

export interface RouteGate {
  x: number;
  y: number;
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  halfW: number;
  leftW: number;
  rightW: number;
}

interface RouteChain {
  id: number;
  cls: number;
  tier: ClearanceTier;
  clusterHalfW: number;
  refcount: number;
  gates: RouteGate[];
}

interface RejoinMemo {
  reset(): void;
  readonly keyLo: Int32Array;
  readonly keyHi: Int32Array;
  readonly val: Int8Array;
}

export interface RouteChainStore {
  acquireChain(
    cls: number,
    tier: ClearanceTier,
    clusterHalfW: number,
    gates: RouteGate[],
    refcount: number,
  ): number;
  releaseChain(chainId: number): void;
  getChain(chainId: number): RouteChain | undefined;
  readonly rejoinMemo: RejoinMemo;
  save(): Serializable;
  load(data: Serializable): void;
}

export function createRouteChainStore(): RouteChainStore {
  const chainSlots: (RouteChain | undefined)[] = [undefined];
  const freeIds: number[] = [];
  let nextId = 1;

  const rjKeyLo = new Int32Array(256).fill(-1);
  const rjKeyHi = new Int32Array(256).fill(-1);
  const rjVal = new Int8Array(256);

  const rejoinMemo: RejoinMemo = {
    keyLo: rjKeyLo,
    keyHi: rjKeyHi,
    val: rjVal,
    reset(): void {
      rjKeyLo.fill(-1);
      rjKeyHi.fill(-1);
    },
  };

  return {
    rejoinMemo,

    acquireChain(cls, tier, clusterHalfW, gates, refcount) {
      const id = freeIds.length > 0 ? (freeIds.shift() ?? nextId++) : nextId++;
      chainSlots[id] = { id, cls, tier, clusterHalfW, refcount, gates };
      return id;
    },

    releaseChain(chainId) {
      if (chainId <= 0) {
        return;
      }
      const chain = chainSlots[chainId];
      if (chain === undefined) {
        return;
      }
      chain.refcount -= 1;
      if (chain.refcount > 0) {
        return;
      }
      chainSlots[chainId] = undefined;
      const at = freeIds.findIndex((f) => f > chainId);
      if (at === -1) {
        freeIds.push(chainId);
      } else {
        freeIds.splice(at, 0, chainId);
      }
    },

    getChain(chainId) {
      return chainId > 0 ? chainSlots[chainId] : undefined;
    },

    save(): Serializable {
      const chains: Serializable[] = [];
      for (let id = 1; id < chainSlots.length; id++) {
        const c = chainSlots[id];
        if (c !== undefined) {
          chains.push({
            ...c,
            gates: c.gates.map((g) => ({ ...g })),
          });
        }
      }
      return { nextId, freeIds: [...freeIds], chains };
    },

    load(data: Serializable): void {
      const saved = data as unknown as { nextId: number; freeIds: number[]; chains: RouteChain[] };
      chainSlots.length = 1;
      chainSlots[0] = undefined;
      freeIds.length = 0;
      freeIds.push(...saved.freeIds);
      nextId = saved.nextId;
      rejoinMemo.reset();
      for (const c of saved.chains) {
        chainSlots[c.id] = {
          id: c.id,
          cls: c.cls,
          tier: c.tier === HEAVY_TIER ? HEAVY_TIER : STD_TIER,
          clusterHalfW: c.clusterHalfW,
          refcount: c.refcount,
          gates: c.gates.map((g) => ({ ...g })),
        };
      }
    },
  };
}

export function releaseRouteFollow(
  store: RouteChainStore,
  routeOut: RouteFollowView,
  id: number,
): void {
  if ((routeOut.active[id] as number) === 1) {
    store.releaseChain(routeOut.chain[id] as number);
    routeOut.chain[id] = 0;
    routeOut.gate[id] = 0;
    routeOut.lane[id] = 0;
    routeOut.active[id] = 0;
  }
}

function probeSide(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  px: number,
  py: number,
  sxStep: number,
  syStep: number,
): number {
  let clear = 0;
  let prevCx = clearanceAnchorCell(px, tier);
  let prevCy = clearanceAnchorCell(py, tier);
  for (let d = 0.5; d <= MAX_GATE_HALF_W + 1e-9; d += 0.5) {
    const sx = px + sxStep * d;
    const sy = py + syStep * d;
    const cx = clearanceAnchorCell(sx, tier);
    const cy = clearanceAnchorCell(sy, tier);
    if (!terrain.inBounds(Math.floor(sx), Math.floor(sy)) || !terrain.passable(cx, cy, cls, tier)) {
      break;
    }
    if (
      (cx !== prevCx || cy !== prevCy) &&
      terrain.stepCost(prevCx, prevCy, cx, cy, cls, tier) < 0
    ) {
      break;
    }
    prevCx = cx;
    prevCy = cy;
    clear = d;
  }
  return clear;
}

export function buildWideGate(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  px: number,
  py: number,
  tx: number,
  ty: number,
  prevGate?: RouteGate,
): RouteGate {
  const nx = -ty;
  const ny = tx;
  const rightClear = probeSide(terrain, cls, tier, px, py, nx, ny);
  const leftClear = probeSide(terrain, cls, tier, px, py, -nx, -ny);
  const bias = Math.max(-2.25, Math.min(2.25, (rightClear - leftClear) * 0.5));
  const candX = px + nx * bias;
  const candY = py + ny * bias;
  const recenter =
    Math.abs(bias) > 1e-4 &&
    terrain.inBounds(Math.floor(candX), Math.floor(candY)) &&
    terrain.passable(
      clearanceAnchorCell(candX, tier),
      clearanceAnchorCell(candY, tier),
      cls,
      tier,
    ) &&
    lineWalkable(terrain, cls, px, py, candX, candY, tier) &&
    (prevGate === undefined ||
      lineWalkable(terrain, cls, prevGate.x, prevGate.y, candX, candY, tier));
  const gx = recenter ? candX : px;
  const gy = recenter ? candY : py;
  const rClear = recenter ? probeSide(terrain, cls, tier, gx, gy, nx, ny) : rightClear;
  const lClear = recenter ? probeSide(terrain, cls, tier, gx, gy, -nx, -ny) : leftClear;
  const leftW = Math.max(0, Math.min(MAX_GATE_HALF_W, lClear - 0.35));
  const rightW = Math.max(0, Math.min(MAX_GATE_HALF_W, rClear - 0.35));
  return {
    x: gx,
    y: gy,
    ax: clearanceAnchorCell(gx, tier),
    ay: clearanceAnchorCell(gy, tier),
    tx,
    ty,
    nx,
    ny,
    halfW: (leftW + rightW) * 0.5,
    leftW,
    rightW,
  };
}

export function gateLanePoint(
  g: RouteGate,
  lane: number,
  clusterHalfW: number,
  out: { x: number; y: number },
): void {
  const sideW = lane >= 0 ? g.rightW : g.leftW;
  const latOff = lane * (clusterHalfW < sideW ? clusterHalfW : sideW);
  out.x = g.x + g.nx * latOff;
  out.y = g.y + g.ny * latOff;
}

function writeRejoinDir(
  first: number,
  startAx: number,
  startAy: number,
  tier: ClearanceTier,
  px: number,
  py: number,
  outDir: { dx: number; dy: number },
): boolean {
  const firstDir = DIRS[first];
  if (firstDir === undefined) {
    return false;
  }
  const tx = clearanceAnchorCenter(startAx + firstDir[0], tier) - px;
  const ty = clearanceAnchorCenter(startAy + firstDir[1], tier) - py;
  const valid = tx * tx + ty * ty > 1e-6;
  outDir.dx = valid ? tx : firstDir[0];
  outDir.dy = valid ? ty : firstDir[1];
  return true;
}

export function boundedLocalRejoin(
  store: RouteChainStore,
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  px: number,
  py: number,
  gx: number,
  gy: number,
  outDir: { dx: number; dy: number },
): boolean {
  const startAx = clearanceAnchorCell(px, tier);
  const startAy = clearanceAnchorCell(py, tier);
  const targetAx = clearanceAnchorCell(gx, tier);
  const targetAy = clearanceAnchorCell(gy, tier);
  if (
    (startAx === targetAx && startAy === targetAy) ||
    Math.abs(targetAx - startAx) > LOCAL_REJOIN_RADIUS ||
    Math.abs(targetAy - startAy) > LOCAL_REJOIN_RADIUS
  ) {
    return false;
  }

  const memo = store.rejoinMemo;
  const lo =
    (startAx & 0xfff) | ((startAy & 0xfff) << 12) | ((cls & 0x3f) << 24) | ((tier & 1) << 30);
  const hi = (targetAx & 0xfff) | ((targetAy & 0xfff) << 12);
  const idx = (Math.imul(lo, -1640531527) ^ Math.imul(hi, -2048144777)) & 255;
  if ((memo.keyLo[idx] as number) === lo && (memo.keyHi[idx] as number) === hi) {
    const first = memo.val[idx] as number;
    return first < 0 ? false : writeRejoinDir(first, startAx, startAy, tier, px, py, outDir);
  }

  bfsStamp += 1;
  if (bfsStamp >= 0x7fffffff) {
    bfsSeen.fill(0);
    bfsStamp = 1;
  }
  const stamp = bfsStamp;
  const startLi = LOCAL_REJOIN_RADIUS * BFS_WIN + LOCAL_REJOIN_RADIUS;
  bfsSeen[startLi] = stamp;
  bfsQueue[0] = startLi;
  bfsFirstDir[0] = -1;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const curLi = bfsQueue[head] as number;
    const curFirst = bfsFirstDir[head] as number;
    head += 1;
    const lx = curLi % BFS_WIN;
    const ly = (curLi - lx) / BFS_WIN;
    const wx = startAx + lx - LOCAL_REJOIN_RADIUS;
    const wy = startAy + ly - LOCAL_REJOIN_RADIUS;
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d];
      if (dir === undefined) {
        continue;
      }
      const nlx = lx + dir[0];
      const nly = ly + dir[1];
      if (nlx < 0 || nlx >= BFS_WIN || nly < 0 || nly >= BFS_WIN) {
        continue;
      }
      const nli = nly * BFS_WIN + nlx;
      if ((bfsSeen[nli] as number) === stamp) {
        continue;
      }
      const nwx = startAx + nlx - LOCAL_REJOIN_RADIUS;
      const nwy = startAy + nly - LOCAL_REJOIN_RADIUS;
      if (terrain.stepCost(wx, wy, nwx, nwy, cls, tier) < 0) {
        continue;
      }
      const first = curFirst === -1 ? d : curFirst;
      if (nwx === targetAx && nwy === targetAy) {
        memo.keyLo[idx] = lo;
        memo.keyHi[idx] = hi;
        memo.val[idx] = first;
        return writeRejoinDir(first, startAx, startAy, tier, px, py, outDir);
      }
      bfsSeen[nli] = stamp;
      bfsQueue[tail] = nli;
      bfsFirstDir[tail] = first;
      tail += 1;
    }
  }
  memo.keyLo[idx] = lo;
  memo.keyHi[idx] = hi;
  memo.val[idx] = -1;
  return false;
}
