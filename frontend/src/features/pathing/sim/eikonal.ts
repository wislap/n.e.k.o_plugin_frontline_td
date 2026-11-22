// Resumable upwind Eikonal solver with pooled Dial ring bucket queues and
// pooled GoalFields (ADR 0055). All arithmetic is integer/Math.sqrt only.
import { CLEARANCE_STANDARD, type ClearanceTier } from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { UNREACHABLE } from './dijkstra';
import {
  COST_SCALE,
  DIR_E,
  DIR_N,
  DIR_NE,
  DIR_NW,
  DIR_ORDER,
  DIR_S,
  DIR_SE,
  DIR_SW,
  DIR_W,
  type SlotCache,
} from './grid-cache';

const MAX_POOLED_QUEUES = 16;
const MAX_POOLED_FIELDS = 16;
const MIN_RING_SIZE = 2048;
const INF = UNREACHABLE;
const SCALE = COST_SCALE;
const STD_TIER = CLEARANCE_STANDARD;

interface FrontierQueue {
  ringSize: number;
  ringMask: number;
  head: Int32Array;
  tail: Int32Array;
  prev: Int32Array;
  next: Int32Array;
  cur: number;
  openCount: number;
}

export interface GoalField {
  gx: number;
  gy: number;
  cls: number;
  tier: ClearanceTier;
  u: Int32Array;
  state: Uint8Array;
  dirPacked: Uint8Array;
  quadFlags: Uint8Array;
  exhausted: boolean;
  queue: FrontierQueue | null;
}

export interface EikonalPools {
  readonly queues: FrontierQueue[];
  readonly fields: GoalField[];
}

export function createEikonalPools(): EikonalPools {
  return { queues: [], fields: [] };
}

function nextPowerOf2(minSize: number): number {
  let size = MIN_RING_SIZE;
  while (size < minSize) {
    size *= 2;
  }
  return size;
}

function acquireQueue(pools: EikonalPools, minRingSize: number, cellCount: number): FrontierQueue {
  const targetSize = nextPowerOf2(minRingSize);
  const reused = pools.queues.pop();
  if (reused !== undefined) {
    if (reused.head.length < targetSize) {
      reused.head = new Int32Array(targetSize);
      reused.tail = new Int32Array(targetSize);
    }
    if (reused.prev.length < cellCount) {
      reused.prev = new Int32Array(cellCount);
      reused.next = new Int32Array(cellCount);
    }
    reused.ringSize = targetSize;
    reused.ringMask = targetSize - 1;
    reused.head.fill(-1, 0, targetSize);
    reused.tail.fill(-1, 0, targetSize);
    reused.cur = 0;
    reused.openCount = 0;
    return reused;
  }
  return {
    ringSize: targetSize,
    ringMask: targetSize - 1,
    head: new Int32Array(targetSize).fill(-1),
    tail: new Int32Array(targetSize).fill(-1),
    prev: new Int32Array(cellCount),
    next: new Int32Array(cellCount),
    cur: 0,
    openCount: 0,
  };
}

function recycleQueue(pools: EikonalPools, queue: FrontierQueue): void {
  if (pools.queues.length < MAX_POOLED_QUEUES) {
    pools.queues.push(queue);
  }
}

function growQueue(q: FrontierQueue, neededSpan: number, u: Int32Array): void {
  const oldSize = q.ringSize;
  const oldHead = q.head;
  let newSize = oldSize * 2;
  while (neededSpan >= newSize) {
    newSize *= 2;
  }
  const newMask = newSize - 1;
  const newHead = new Int32Array(newSize).fill(-1);
  const newTail = new Int32Array(newSize).fill(-1);
  for (let b = 0; b < oldSize; b++) {
    let node = oldHead[b] as number;
    while (node !== -1) {
      const nxt = q.next[node] as number;
      const nb = (u[node] as number) & newMask;
      const tail = newTail[nb] as number;
      if (tail === -1) {
        newHead[nb] = node;
        q.prev[node] = -1;
      } else {
        q.next[tail] = node;
        q.prev[node] = tail;
      }
      q.next[node] = -1;
      newTail[nb] = node;
      node = nxt;
    }
  }
  q.head = newHead;
  q.tail = newTail;
  q.ringSize = newSize;
  q.ringMask = newMask;
}

function insertOpen(q: FrontierQueue, cell: number, cost: number, u: Int32Array): void {
  const span = cost - q.cur;
  if (span >= q.ringSize) {
    growQueue(q, span, u);
  }
  const b = cost & q.ringMask;
  const t = q.tail[b] as number;
  q.prev[cell] = t;
  q.next[cell] = -1;
  if (t === -1) {
    q.head[b] = cell;
  } else {
    q.next[t] = cell;
  }
  q.tail[b] = cell;
  q.openCount += 1;
}

function removeOpen(q: FrontierQueue, cell: number, oldCost: number): void {
  const b = oldCost & q.ringMask;
  const p = q.prev[cell] as number;
  const n = q.next[cell] as number;
  if (p === -1) {
    q.head[b] = n;
  } else {
    q.next[p] = n;
  }
  if (n === -1) {
    q.tail[b] = p;
  } else {
    q.prev[n] = p;
  }
  q.prev[cell] = -1;
  q.next[cell] = -1;
  q.openCount -= 1;
}

export function acquireGoalField(
  pools: EikonalPools,
  terrain: TerrainApi,
  slotCache: SlotCache,
  gx: number,
  gy: number,
  cls: number,
  tier: ClearanceTier,
): GoalField {
  const size = slotCache.size;
  let field = pools.fields.pop();
  if (field === undefined) {
    field = {
      gx,
      gy,
      cls,
      tier,
      u: new Int32Array(size),
      state: new Uint8Array(size),
      dirPacked: new Uint8Array(size),
      quadFlags: new Uint8Array(size),
      exhausted: true,
      queue: null,
    };
  } else {
    if (field.u.length < size) {
      field.u = new Int32Array(size);
      field.state = new Uint8Array(size);
      field.dirPacked = new Uint8Array(size);
      field.quadFlags = new Uint8Array(size);
    }
    field.gx = gx;
    field.gy = gy;
    field.cls = cls;
    field.tier = tier;
  }
  field.state.fill(0, 0, size);
  field.dirPacked.fill(0, 0, size);
  field.quadFlags.fill(0, 0, size);

  const goalIdx = gy * slotCache.width + gx;
  if (!terrain.inBounds(gx, gy) || !slotCache.ensureCellBaked(gx, gy, goalIdx)) {
    field.exhausted = true;
    field.queue = null;
    return field;
  }

  const minRing = Math.max(MIN_RING_SIZE, slotCache.maxStepScaled * 2 + 128);
  const queue = acquireQueue(pools, minRing, size);
  field.u[goalIdx] = 0;
  field.state[goalIdx] = 1;
  insertOpen(queue, goalIdx, 0, field.u);
  field.exhausted = false;
  field.queue = queue;
  return field;
}

export function releaseGoalField(pools: EikonalPools, field: GoalField): void {
  if (field.queue !== null) {
    recycleQueue(pools, field.queue);
    field.queue = null;
  }
  field.exhausted = true;
  if (pools.fields.length < MAX_POOLED_FIELDS) {
    pools.fields.push(field);
  }
}

export function expandUntil(
  pools: EikonalPools,
  field: GoalField,
  slotCache: SlotCache,
  terrain: TerrainApi,
  targetCell: number,
): void {
  const queue = field.queue;
  if (field.exhausted || queue === null) {
    field.exhausted = true;
    return;
  }
  const { width, height, size, baked, dirMask, enterCost, cls, tier } = slotCache;
  const { u, state, gx, gy } = field;
  const isStd = tier === STD_TIER;
  let head = queue.head;
  let tail = queue.tail;
  const prev = queue.prev;
  const next = queue.next;
  let ringSize = queue.ringSize;
  let ringMask = queue.ringMask;
  let cur = queue.cur;
  let openCount = queue.openCount;

  while ((state[targetCell] as number) !== 2) {
    if (openCount === 0) {
      field.exhausted = true;
      queue.cur = cur;
      queue.openCount = 0;
      recycleQueue(pools, queue);
      field.queue = null;
      return;
    }
    while ((head[cur & ringMask] as number) === -1) {
      cur += 1;
    }
    const popBucket = cur & ringMask;
    const cell = head[popBucket] as number;
    const popNext = next[cell] as number;
    head[popBucket] = popNext;
    if (popNext === -1) {
      tail[popBucket] = -1;
    } else {
      prev[popNext] = -1;
    }
    openCount -= 1;
    if ((state[cell] as number) === 2) {
      continue;
    }

    const c = u[cell] as number;
    state[cell] = 2;
    const cx = cell % width;

    if (c === 0) {
      const cy = (cell - cx) / width;
      queue.cur = cur;
      queue.openCount = openCount;
      for (let d = 0; d < 8; d++) {
        const dir = DIR_ORDER[d];
        if (dir === undefined) {
          continue;
        }
        const nx = cx + dir[0];
        const ny = cy + dir[1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        const stepInto = terrain.stepCost(nx, ny, gx, gy, cls, tier);
        if (stepInto < 0) {
          continue;
        }
        const ni = ny * width + nx;
        const stNi = state[ni] as number;
        if (stNi === 2) {
          continue;
        }
        if ((baked[ni] as number) === 0) {
          slotCache.ensureCellBaked(nx, ny, ni);
        }
        let cand: number;
        if (d < 4) {
          cand = stepInto * SCALE;
        } else {
          const cOrtho1 = terrain.stepCost(nx, gy, gx, gy, cls, tier);
          const cOrtho2 = terrain.stepCost(gx, ny, gx, gy, cls, tier);
          const wDiagBase =
            cOrtho1 >= 0 && cOrtho2 >= 0 ? Math.max(cOrtho1, cOrtho2) : stepInto * (10 / 14);
          const rawDiag = (wDiagBase * SCALE * Math.SQRT2 + 0.5) | 0;
          cand = rawDiag > 1 ? rawDiag : 1;
        }
        const prevCost = stNi === 0 ? INF : (u[ni] as number);
        if (cand < prevCost) {
          if (stNi === 1) {
            removeOpen(queue, ni, prevCost);
          }
          u[ni] = cand;
          state[ni] = 1;
          insertOpen(queue, ni, cand, u);
        }
      }
      cur = queue.cur;
      openCount = queue.openCount;
      head = queue.head;
      tail = queue.tail;
      ringSize = queue.ringSize;
      ringMask = queue.ringMask;
    } else {
      for (let d = 0; d < 4; d++) {
        let ni: number;
        let reqBit: number;
        if (d === 0) {
          if (cell < width) {
            continue;
          }
          ni = cell - width;
          reqBit = DIR_S;
        } else if (d === 1) {
          if (cx + 1 >= width) {
            continue;
          }
          ni = cell + 1;
          reqBit = DIR_W;
        } else if (d === 2) {
          if (cell + width >= size) {
            continue;
          }
          ni = cell + width;
          reqBit = DIR_N;
        } else {
          if (cx <= 0) {
            continue;
          }
          ni = cell - 1;
          reqBit = DIR_E;
        }
        const stNi = state[ni] as number;
        if (stNi === 2) {
          continue;
        }
        if ((baked[ni] as number) === 0) {
          const bnx = ni % width;
          slotCache.ensureCellBaked(bnx, (ni - bnx) / width, ni);
        }
        const nMask = dirMask[ni] as number;
        if ((nMask & reqBit) === 0) {
          continue;
        }

        let nx = 0;
        let ny = 0;
        if (!isStd) {
          nx = ni % width;
          ny = (ni - nx) / width;
        }

        let ux = INF;
        let wx = 0;
        let xDir = 0;
        let bestXTotal = INF;
        if ((nMask & DIR_W) !== 0 && (state[ni - 1] as number) === 2) {
          const a = ni - 1;
          const st = isStd
            ? (enterCost[a] as number)
            : terrain.stepCost(nx, ny, nx - 1, ny, cls, tier) * SCALE;
          const ua = u[a] as number;
          const tot = ua + st;
          if (tot < bestXTotal) {
            bestXTotal = tot;
            ux = ua;
            wx = st;
            xDir = -1;
          }
        }
        if ((nMask & DIR_E) !== 0 && (state[ni + 1] as number) === 2) {
          const a = ni + 1;
          const st = isStd
            ? (enterCost[a] as number)
            : terrain.stepCost(nx, ny, nx + 1, ny, cls, tier) * SCALE;
          const ua = u[a] as number;
          const tot = ua + st;
          if (tot < bestXTotal) {
            bestXTotal = tot;
            ux = ua;
            wx = st;
            xDir = 1;
          }
        }

        let uy = INF;
        let wy = 0;
        let yDir = 0;
        let bestYTotal = INF;
        if ((nMask & DIR_N) !== 0 && (state[ni - width] as number) === 2) {
          const a = ni - width;
          const st = isStd
            ? (enterCost[a] as number)
            : terrain.stepCost(nx, ny, nx, ny - 1, cls, tier) * SCALE;
          const ua = u[a] as number;
          const tot = ua + st;
          if (tot < bestYTotal) {
            bestYTotal = tot;
            uy = ua;
            wy = st;
            yDir = -1;
          }
        }
        if ((nMask & DIR_S) !== 0 && (state[ni + width] as number) === 2) {
          const a = ni + width;
          const st = isStd
            ? (enterCost[a] as number)
            : terrain.stepCost(nx, ny, nx, ny + 1, cls, tier) * SCALE;
          const ua = u[a] as number;
          const tot = ua + st;
          if (tot < bestYTotal) {
            bestYTotal = tot;
            uy = ua;
            wy = st;
            yDir = 1;
          }
        }

        let best = bestXTotal < bestYTotal ? bestXTotal : bestYTotal;
        if (ux < INF && uy < INF) {
          const diagBit =
            xDir === 1 ? (yDir === -1 ? DIR_NE : DIR_SE) : yDir === -1 ? DIR_NW : DIR_SW;
          if ((nMask & diagBit) !== 0) {
            const wMax = wx > wy ? wx : wy;
            const diff = ux > uy ? ux - uy : uy - ux;
            if (diff < wMax) {
              const quad = (0.5 * (ux + uy + Math.sqrt(2 * wMax * wMax - diff * diff)) + 0.5) | 0;
              const maxParent = ux > uy ? ux : uy;
              const safeQuad = quad > maxParent ? quad : maxParent + 1;
              if (safeQuad < best) {
                best = safeQuad;
              }
            }
          }
        }

        const prevCost = stNi === 0 ? INF : (u[ni] as number);
        if (best < prevCost) {
          if (stNi === 1) {
            const oldB = prevCost & ringMask;
            const p = prev[ni] as number;
            const n = next[ni] as number;
            if (p === -1) {
              head[oldB] = n;
            } else {
              next[p] = n;
            }
            if (n === -1) {
              tail[oldB] = p;
            } else {
              prev[n] = p;
            }
            openCount -= 1;
          }
          u[ni] = best;
          state[ni] = 1;
          const span = best - cur;
          if (span >= ringSize) {
            queue.cur = cur;
            queue.openCount = openCount;
            growQueue(queue, span, u);
            head = queue.head;
            tail = queue.tail;
            ringSize = queue.ringSize;
            ringMask = queue.ringMask;
          }
          const nb = best & ringMask;
          const t = tail[nb] as number;
          prev[ni] = t;
          next[ni] = -1;
          if (t === -1) {
            head[nb] = ni;
          } else {
            next[t] = ni;
          }
          tail[nb] = ni;
          openCount += 1;
        }
      }
    }

    if (openCount === 0) {
      field.exhausted = true;
      queue.cur = cur;
      queue.openCount = 0;
      recycleQueue(pools, queue);
      field.queue = null;
      return;
    }
  }
  queue.cur = cur;
  queue.openCount = openCount;
}
