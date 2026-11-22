// Per-(cls, tier) lazy terrain baking and undirected connected components
// (ADR 0055). All arrays are pre-allocated TypedArrays; cells bake on first
// visit and invalidate locally when dynamic blockers change.
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  heightStepPassable,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';

// Neighbour order for direction pick: N, E, S, W, NE, SE, SW, NW.
export const DIR_ORDER = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
] as const;

// dirMask bit layout matching DIR_ORDER indices 0..7.
export const DIR_N = 1;
export const DIR_E = 2;
export const DIR_S = 4;
export const DIR_W = 8;
export const DIR_NE = 16;
export const DIR_SE = 32;
export const DIR_SW = 64;
export const DIR_NW = 128;
export const DIR_CARDINAL = DIR_N | DIR_E | DIR_S | DIR_W;

// Orthogonal check offsets matching DIR_ORDER diagonals (NE, SE, SW, NW).
const DIAG_LEGS: readonly [number, number][] = [
  [0, 1], // NE = N & E
  [2, 1], // SE = S & E
  [2, 3], // SW = S & W
  [0, 3], // NW = N & W
];

const STD_TIER = CLEARANCE_STANDARD;
const HEAVY_TIER = CLEARANCE_HEAVY;
const stepPassable = heightStepPassable;

// Sub-cell fixed-point cost scale (10 * 32 = 320 per flat ground cell).
export const COST_SCALE = 32;
export const GROUND_COST_SCALED = 320;
const DEFAULT_MAX_STEP_SCALED = 30 * COST_SCALE;
const SURFACE_CACHE_SIZE = 64;

export interface SlotCache {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly cls: number;
  readonly tier: ClearanceTier;
  readonly baked: Uint8Array;
  readonly dirMask: Uint8Array;
  readonly enterCost: Int32Array;
  maxStepScaled: number;
  readonly compId: Int32Array;
  compValid: boolean;
  readonly bfsQueue: Int32Array;
  ensureCellBaked(x: number, y: number, idx: number): boolean;
  ensureComponents(): void;
  sameComponent(ax: number, ay: number, bx: number, by: number): boolean;
  invalidate(cells: readonly { x: number; y: number }[]): void;
  reset(): void;
}

export function createSlotCache(terrain: TerrainApi, cls: number, tier: ClearanceTier): SlotCache {
  const width = terrain.width;
  const height = terrain.height;
  const size = width * height;
  const baked = new Uint8Array(size);
  const dirMask = new Uint8Array(size);
  const enterCost = new Int32Array(size);
  const compId = new Int32Array(size);
  const bfsQueue = new Int32Array(size);
  const surfCost = new Int16Array(SURFACE_CACHE_SIZE).fill(-2);
  const isStd = tier === STD_TIER;
  const metaCost = new Int16Array(isStd ? size : 0).fill(-2);
  const metaHeight = new Int16Array(isStd ? size : 0);
  const metaRamp = new Uint8Array(isStd ? size : 0);

  // Note: tier-0 surface caching assumes TerrainApi.stepCost depends only on
  // destination cell surface cost plus symmetric heightStepPassable (verified
  // in terrain-api.ts); directional edge costs would invalidate this cache.
  function ensureCellMeta(cx: number, cy: number, ci: number): number {
    const mc = metaCost[ci] as number;
    if (mc !== -2) {
      return mc;
    }
    if (!terrain.passable(cx, cy, cls, STD_TIER)) {
      metaCost[ci] = -1;
      return -1;
    }
    metaHeight[ci] = terrain.heightAt(cx, cy);
    metaRamp[ci] = terrain.isRamp(cx, cy) ? 1 : 0;
    const s = terrain.surfaceAt(cx, cy);
    if (s >= 0 && s < SURFACE_CACHE_SIZE) {
      const cached = surfCost[s] as number;
      if (cached >= 0) {
        metaCost[ci] = cached;
        return cached;
      }
    }
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 1 ? 1 : d === 3 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 0 ? -1 : 0);
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const into = terrain.stepCost(nx, ny, cx, cy, cls, STD_TIER);
      if (into >= 0) {
        if (s >= 0 && s < SURFACE_CACHE_SIZE) {
          surfCost[s] = into;
        }
        metaCost[ci] = into;
        return into;
      }
    }
    metaCost[ci] = 0;
    return 0;
  }

  const cache: SlotCache = {
    width,
    height,
    size,
    cls,
    tier,
    baked,
    dirMask,
    enterCost,
    maxStepScaled: DEFAULT_MAX_STEP_SCALED,
    compId,
    compValid: false,
    bfsQueue,

    ensureCellBaked(x, y, idx) {
      const b = baked[idx] as number;
      if (b !== 0) {
        return b === 2;
      }
      if (isStd) {
        const c0 = ensureCellMeta(x, y, idx);
        if (c0 < 0) {
          baked[idx] = 1;
          dirMask[idx] = 0;
          enterCost[idx] = 0;
          return false;
        }
        baked[idx] = 2;
        const h0 = metaHeight[idx] as number;
        const r0 = metaRamp[idx] as number;
        let mask = 0;
        for (let d = 0; d < 4; d++) {
          const dx = d === 1 ? 1 : d === 3 ? -1 : 0;
          const dy = d === 2 ? 1 : d === 0 ? -1 : 0;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
          const ni = ny * width + nx;
          const cn = ensureCellMeta(nx, ny, ni);
          if (
            cn >= 0 &&
            (h0 === (metaHeight[ni] as number) ||
              stepPassable(h0, metaHeight[ni] as number, r0, metaRamp[ni] as number))
          ) {
            mask |= 1 << d;
            const scaled = cn * COST_SCALE;
            if (scaled > cache.maxStepScaled) {
              cache.maxStepScaled = scaled;
            }
          }
        }
        const repEnter = (mask & DIR_CARDINAL) !== 0 ? c0 * COST_SCALE : 0;
        if (repEnter > cache.maxStepScaled) {
          cache.maxStepScaled = repEnter;
        }
        for (let i = 0; i < 4; i++) {
          const legMask = i === 0 ? 3 : i === 1 ? 6 : i === 2 ? 12 : 9;
          if ((mask & legMask) !== legMask) {
            continue;
          }
          const nx = x + (i < 2 ? 1 : -1);
          const ny = y + (i === 1 || i === 2 ? 1 : -1);
          const dni = ny * width + nx;
          const cd = ensureCellMeta(nx, ny, dni);
          if (
            cd >= 0 &&
            (h0 === (metaHeight[dni] as number) ||
              stepPassable(h0, metaHeight[dni] as number, r0, metaRamp[dni] as number))
          ) {
            mask |= 1 << (4 + i);
            const diagScaled = (((cd * 14) / 10) | 0) * COST_SCALE;
            if (diagScaled > cache.maxStepScaled) {
              cache.maxStepScaled = diagScaled;
            }
          }
        }
        dirMask[idx] = mask;
        enterCost[idx] = repEnter;
        return true;
      }

      if (!terrain.passable(x, y, cls, tier)) {
        baked[idx] = 1;
        dirMask[idx] = 0;
        enterCost[idx] = 0;
        return false;
      }
      baked[idx] = 2;
      let mask = 0;
      let repEnter = 0;
      let hasEnter = false;
      for (let d = 0; d < 4; d++) {
        const dir = DIR_ORDER[d];
        if (dir === undefined) {
          continue;
        }
        const nx = x + dir[0];
        const ny = y + dir[1];
        const step = terrain.stepCost(x, y, nx, ny, cls, tier);
        if (step >= 0) {
          mask |= 1 << d;
          const scaled = step * COST_SCALE;
          if (scaled > cache.maxStepScaled) {
            cache.maxStepScaled = scaled;
          }
          if (!hasEnter) {
            const into = terrain.stepCost(nx, ny, x, y, cls, tier);
            if (into >= 0) {
              const intoScaled = into * COST_SCALE;
              repEnter = intoScaled;
              hasEnter = true;
              if (intoScaled > cache.maxStepScaled) {
                cache.maxStepScaled = intoScaled;
              }
            }
          }
        }
      }
      for (let i = 0; i < 4; i++) {
        const legs = DIAG_LEGS[i];
        if (legs === undefined || (mask & (1 << legs[0])) === 0 || (mask & (1 << legs[1])) === 0) {
          continue;
        }
        const d = 4 + i;
        const dir = DIR_ORDER[d];
        if (dir === undefined) {
          continue;
        }
        const step = terrain.stepCost(x, y, x + dir[0], y + dir[1], cls, tier);
        if (step >= 0) {
          mask |= 1 << d;
          const scaled = step * COST_SCALE;
          if (scaled > cache.maxStepScaled) {
            cache.maxStepScaled = scaled;
          }
        }
      }
      dirMask[idx] = mask;
      enterCost[idx] = repEnter;
      return true;
    },

    ensureComponents() {
      if (cache.compValid) {
        return;
      }
      compId.fill(0);
      let nextComp = 0;
      for (let start = 0; start < size; start++) {
        if ((compId[start] as number) !== 0) {
          continue;
        }
        const sx = start % width;
        const sy = (start - sx) / width;
        if (!cache.ensureCellBaked(sx, sy, start)) {
          continue;
        }
        nextComp += 1;
        compId[start] = nextComp;
        let qHead = 0;
        let qTail = 0;
        bfsQueue[qTail++] = start;
        while (qHead < qTail) {
          const curr = bfsQueue[qHead++] as number;
          const cx = curr % width;
          const cy = (curr - cx) / width;
          const cMask = dirMask[curr] as number;
          for (let d = 0; d < 4; d++) {
            if ((cMask & (1 << d)) === 0) {
              continue;
            }
            const dir = DIR_ORDER[d];
            if (dir === undefined) {
              continue;
            }
            const nx = cx + dir[0];
            const ny = cy + dir[1];
            if (!terrain.inBounds(nx, ny)) {
              continue;
            }
            const ni = ny * width + nx;
            if ((compId[ni] as number) !== 0 || !cache.ensureCellBaked(nx, ny, ni)) {
              continue;
            }
            if (((dirMask[ni] as number) & (1 << ((d + 2) & 3))) === 0) {
              continue;
            }
            compId[ni] = nextComp;
            bfsQueue[qTail++] = ni;
          }
        }
      }
      cache.compValid = true;
    },

    sameComponent(ax, ay, bx, by) {
      if (!terrain.inBounds(ax, ay) || !terrain.inBounds(bx, by)) {
        return false;
      }
      cache.ensureComponents();
      const ca = compId[ay * width + ax] as number;
      if (ca === 0) {
        return false;
      }
      return ca === (compId[by * width + bx] as number);
    },

    invalidate(cells) {
      cache.compValid = false;
      const minOff = tier === HEAVY_TIER ? -2 : -1;
      const maxOff = 1;
      for (const cell of cells) {
        for (let dy = minOff; dy <= maxOff; dy++) {
          const ny = cell.y + dy;
          if (ny < 0 || ny >= height) {
            continue;
          }
          const rowOffset = ny * width;
          for (let dx = minOff; dx <= maxOff; dx++) {
            const nx = cell.x + dx;
            if (nx >= 0 && nx < width) {
              const ci = rowOffset + nx;
              baked[ci] = 0;
              if (isStd) {
                metaCost[ci] = -2;
              }
            }
          }
        }
      }
    },

    reset() {
      baked.fill(0);
      surfCost.fill(-2);
      if (isStd) {
        metaCost.fill(-2);
      }
      cache.compValid = false;
      cache.maxStepScaled = DEFAULT_MAX_STEP_SCALED;
    },
  };

  return cache;
}
