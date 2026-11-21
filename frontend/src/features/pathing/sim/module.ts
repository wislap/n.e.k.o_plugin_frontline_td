// Pathing module (ADR 0010, ADR 0052, ADR 0055): ref-counted goals,
// per-(cls, tier) lazy terrain baking & connected components, and resumable
// upwind Eikonal distance/flow fields. Caches are derived data — recomputed
// on demand, never serialized.
import type { Serializable } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  CLEARANCE_TIERS,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { UNREACHABLE } from './dijkstra';
import {
  acquireGoalField,
  createEikonalPools,
  expandUntil,
  releaseGoalField,
  type GoalField,
} from './eikonal';
import {
  COST_SCALE,
  createSlotCache,
  DIR_ORDER,
  GROUND_COST_SCALED,
  type SlotCache,
} from './grid-cache';

const INF = UNREACHABLE;
const SCALE = COST_SCALE;
const GROUND_SCALED = GROUND_COST_SCALED;
const STD_TIER = CLEARANCE_STANDARD;
const HEAVY_TIER = CLEARANCE_HEAVY;
const TIER_COUNT = CLEARANCE_TIERS;
const DIR_DX = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
const DIR_DY = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1]);

interface Direction {
  dx: number;
  dy: number;
}

export interface PathingApi {
  acquireGoal(x: number, y: number, cls: number, tier?: ClearanceTier): number;
  releaseGoal(goalId: number): void;
  goalRefCount(goalId: number): number;
  reachable(
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    cls: number,
    tier?: ClearanceTier,
  ): boolean;
  distanceAt(goalId: number, px: number, py: number): number | null;
  // Reuses an internal scratch object — do not hold the result across calls.
  directionAt(goalId: number, x: number, y: number): Direction | null;
  // Reuses a separate internal scratch object — safe to interleave with directionAt.
  smoothDirectionAt(goalId: number, px: number, py: number): Direction | null;
  invalidateCells(cells: readonly { x: number; y: number }[]): void;
}

interface Goal {
  x: number;
  y: number;
  cls: number;
  tier: ClearanceTier;
  refcount: number;
}

const STAGE1_QUAD_OK = 1;
const STAGE2_CARD_OK = 2;
const STAGE1_QUAD_DONE = 4;
const STAGE2_CARD_DONE = 8;

function quadPassableBothWays(sc: SlotCache, x00: number, y00: number): boolean {
  const w = sc.width;
  const i00 = y00 * w + x00;
  const i10 = i00 + 1;
  const i01 = i00 + w;
  const i11 = i01 + 1;
  const m00 = sc.dirMask[i00] as number;
  const m10 = sc.dirMask[i10] as number;
  const m01 = sc.dirMask[i01] as number;
  const m11 = sc.dirMask[i11] as number;
  // DIR_ORDER bits: N=1, E=2, S=4, W=8, NE=16, SE=32, SW=64, NW=128.
  return (
    (m00 & 2) !== 0 &&
    (m10 & 8) !== 0 &&
    (m01 & 2) !== 0 &&
    (m11 & 8) !== 0 &&
    (m00 & 4) !== 0 &&
    (m01 & 1) !== 0 &&
    (m10 & 4) !== 0 &&
    (m11 & 1) !== 0 &&
    (m00 & 32) !== 0 &&
    (m11 & 128) !== 0 &&
    (m10 & 64) !== 0 &&
    (m01 & 16) !== 0
  );
}

export function createPathingModule(
  terrain: TerrainApi,
  classCount: number,
): { module: SimModule; api: PathingApi } {
  const goalSlots: (Goal | undefined)[] = [];
  const goalByKey = new Map<number, number>();
  const freeIds: number[] = [];
  let nextId = 0;

  // Derived caches (never serialized).
  const pools = createEikonalPools();
  const fieldSlots: (GoalField | undefined)[] = [];
  const totalSlots = classCount * TIER_COUNT;
  const slotCaches: (SlotCache | undefined)[] = Array.from({ length: totalSlots }, () => undefined);
  const scratch: Direction = { dx: 0, dy: 0 };
  const smoothScratch: Direction = { dx: 0, dy: 0 };

  function ensureSlotCache(cls: number, tier: ClearanceTier): SlotCache {
    if (cls < 0 || cls >= classCount) {
      throw new RangeError(`unknown movement class ${cls}`);
    }
    const slot = tier * classCount + cls;
    let sc = slotCaches[slot];
    if (sc === undefined) {
      sc = createSlotCache(terrain, cls, tier);
      slotCaches[slot] = sc;
    }
    return sc;
  }

  function recycleAllFields(): void {
    for (let i = 0; i < fieldSlots.length; i++) {
      const field = fieldSlots[i];
      if (field !== undefined) {
        releaseGoalField(pools, field);
        fieldSlots[i] = undefined;
      }
    }
  }

  function resetCaches(): void {
    recycleAllFields();
    for (const sc of slotCaches) {
      sc?.reset();
    }
  }

  function goalKey(x: number, y: number, cls: number, tier: ClearanceTier): number {
    return ((tier * classCount + cls) * terrain.height + y) * terrain.width + x;
  }

  function ensureGoalField(goalId: number, goal: Goal): GoalField {
    let field = fieldSlots[goalId];
    if (field === undefined) {
      const sc = ensureSlotCache(goal.cls, goal.tier);
      field = acquireGoalField(pools, terrain, sc, goal.x, goal.y, goal.cls, goal.tier);
      fieldSlots[goalId] = field;
    }
    return field;
  }

  function costAtCell(field: GoalField, sc: SlotCache, x: number, y: number): number {
    const width = terrain.width;
    if (x < 0 || y < 0 || x >= width || y >= terrain.height) {
      return INF;
    }
    const idx = y * width + x;
    if ((field.state[idx] as number) === 2) {
      return field.u[idx] as number;
    }
    if (field.gx < 0 || field.gy < 0 || field.gx >= width || field.gy >= terrain.height) {
      return INF;
    }
    const gIdx = field.gy * width + field.gx;
    if (!sc.ensureCellBaked(x, y, idx) || !sc.ensureCellBaked(field.gx, field.gy, gIdx)) {
      return INF;
    }
    if (sc.compValid && !sc.sameComponent(x, y, field.gx, field.gy)) {
      return INF;
    }
    expandUntil(pools, field, sc, terrain, idx);
    return (field.state[idx] as number) === 2 ? (field.u[idx] as number) : INF;
  }

  function ensureStage1Quad(field: GoalField, sc: SlotCache, x00: number, y00: number): boolean {
    if (x00 < 0 || x00 + 1 >= terrain.width || y00 < 0 || y00 + 1 >= terrain.height) {
      return false;
    }
    const qIdx = y00 * terrain.width + x00;
    const flags = field.quadFlags[qIdx] as number;
    if ((flags & STAGE1_QUAD_DONE) !== 0) {
      return (flags & STAGE1_QUAD_OK) !== 0;
    }
    const c00 = costAtCell(field, sc, x00, y00);
    const c10 = costAtCell(field, sc, x00 + 1, y00);
    const c01 = costAtCell(field, sc, x00, y00 + 1);
    const c11 = costAtCell(field, sc, x00 + 1, y00 + 1);
    const ok =
      c00 < INF && c10 < INF && c01 < INF && c11 < INF && quadPassableBothWays(sc, x00, y00);
    field.quadFlags[qIdx] = flags | STAGE1_QUAD_DONE | (ok ? STAGE1_QUAD_OK : 0);
    return ok;
  }

  function discreteDirAt(
    field: GoalField,
    sc: SlotCache,
    goal: Goal,
    x: number,
    y: number,
    out: Direction,
  ): boolean {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const width = terrain.width;
    if (cx < 0 || cy < 0 || cx >= width || cy >= terrain.height) {
      return false;
    }
    const idx = cy * width + cx;
    let here: number;
    if ((field.state[idx] as number) === 2) {
      here = field.u[idx] as number;
      if (here === 0) {
        out.dx = 0;
        out.dy = 0;
        return true;
      }
      const packed = field.dirPacked[idx] as number;
      if (packed !== 0) {
        out.dx = DIR_DX[packed - 1] as number;
        out.dy = DIR_DY[packed - 1] as number;
        return true;
      }
    } else {
      here = costAtCell(field, sc, cx, cy);
      if (here >= INF) {
        return false;
      }
      if (here === 0) {
        out.dx = 0;
        out.dy = 0;
        return true;
      }
    }

    const mask = sc.dirMask[idx] as number;
    let bestTotal = INF;
    let bestDir = -1;
    for (let d = 0; d < 8; d++) {
      if ((mask & (1 << d)) === 0) {
        continue;
      }
      const dir = DIR_ORDER[d];
      if (dir === undefined) {
        continue;
      }
      const nx = cx + dir[0];
      const ny = cy + dir[1];
      const ni = ny * width + nx;
      if ((field.state[ni] as number) !== 2) {
        continue;
      }
      const uNext = field.u[ni] as number;
      if (uNext >= here) {
        continue;
      }
      const step =
        goal.tier === STD_TIER && d < 4
          ? (sc.enterCost[ni] as number)
          : terrain.stepCost(cx, cy, nx, ny, goal.cls, goal.tier) * SCALE;
      const total = uNext + step;
      if (total < bestTotal) {
        bestTotal = total;
        bestDir = d;
      }
    }
    if (bestDir === -1) {
      return false;
    }
    field.dirPacked[idx] = bestDir + 1;
    out.dx = DIR_DX[bestDir] as number;
    out.dy = DIR_DY[bestDir] as number;
    return true;
  }

  function acquireGoal(x: number, y: number, cls: number, tier: ClearanceTier = STD_TIER): number {
    // Goals are cells: quantize so callers may pass entity positions.
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const resolvedTier: ClearanceTier = tier === HEAVY_TIER ? HEAVY_TIER : STD_TIER;
    const key = goalKey(gx, gy, cls, resolvedTier);
    const existing = goalByKey.get(key);
    if (existing !== undefined) {
      const goal = goalSlots[existing];
      if (goal !== undefined) {
        goal.refcount += 1;
      }
      return existing;
    }
    const id = freeIds.length > 0 ? (freeIds.shift() ?? 0) : nextId++;
    goalSlots[id] = { x: gx, y: gy, cls, tier: resolvedTier, refcount: 1 };
    goalByKey.set(key, id);
    return id;
  }

  function releaseGoal(goalId: number): void {
    const goal = goalSlots[goalId];
    if (goal === undefined) {
      return;
    }
    goal.refcount -= 1;
    if (goal.refcount > 0) {
      return;
    }
    goalSlots[goalId] = undefined;
    goalByKey.delete(goalKey(goal.x, goal.y, goal.cls, goal.tier));
    const field = fieldSlots[goalId];
    if (field !== undefined) {
      releaseGoalField(pools, field);
      fieldSlots[goalId] = undefined;
    }
    // Lowest-free-id reuse: keep the free list sorted.
    const insertAt = freeIds.findIndex((f) => f > goalId);
    if (insertAt === -1) {
      freeIds.push(goalId);
    } else {
      freeIds.splice(insertAt, 0, goalId);
    }
  }

  const api: PathingApi = {
    acquireGoal,
    releaseGoal,

    goalRefCount(goalId) {
      return goalSlots[goalId]?.refcount ?? 0;
    },

    reachable(sx, sy, gx, gy, cls, tier = STD_TIER) {
      const resolvedTier: ClearanceTier = tier === HEAVY_TIER ? HEAVY_TIER : STD_TIER;
      const sc = ensureSlotCache(cls, resolvedTier);
      return sc.sameComponent(Math.floor(sx), Math.floor(sy), Math.floor(gx), Math.floor(gy));
    },

    distanceAt(goalId, px, py) {
      const goal = goalSlots[goalId];
      if (goal === undefined) {
        return null;
      }
      const isHeavy = goal.tier === HEAVY_TIER;
      const cx = isHeavy ? Math.floor(px - 0.5) : Math.floor(px);
      const cy = isHeavy ? Math.floor(py - 0.5) : Math.floor(py);
      const sc = ensureSlotCache(goal.cls, goal.tier);
      const field = ensureGoalField(goalId, goal);
      const here = costAtCell(field, sc, cx, cy);
      if (here >= INF) {
        return null;
      }
      const halfOffset = isHeavy ? 1 : 0.5;
      const x00 = px >= cx + halfOffset ? cx : cx - 1;
      const y00 = py >= cy + halfOffset ? cy : cy - 1;
      if (ensureStage1Quad(field, sc, x00, y00)) {
        const width = terrain.width;
        const i00 = y00 * width + x00;
        const c00 = field.u[i00] as number;
        const c10 = field.u[i00 + 1] as number;
        const c01 = field.u[i00 + width] as number;
        const c11 = field.u[i00 + width + 1] as number;
        const tx = Math.max(0, Math.min(1, px - (x00 + halfOffset)));
        const ty = Math.max(0, Math.min(1, py - (y00 + halfOffset)));
        const interp = (1 - ty) * ((1 - tx) * c00 + tx * c10) + ty * ((1 - tx) * c01 + tx * c11);
        return interp / GROUND_SCALED;
      }
      return here / GROUND_SCALED;
    },

    directionAt(goalId, x, y) {
      const goal = goalSlots[goalId];
      if (goal === undefined) {
        return null;
      }
      const sc = ensureSlotCache(goal.cls, goal.tier);
      const field = ensureGoalField(goalId, goal);
      return discreteDirAt(field, sc, goal, x, y, scratch) ? scratch : null;
    },

    smoothDirectionAt(goalId, px, py) {
      const goal = goalSlots[goalId];
      if (goal === undefined) {
        return null;
      }
      const sc = ensureSlotCache(goal.cls, goal.tier);
      const field = ensureGoalField(goalId, goal);
      const isHeavy = goal.tier === HEAVY_TIER;
      const cx = isHeavy ? Math.floor(px - 0.5) : Math.floor(px);
      const cy = isHeavy ? Math.floor(py - 0.5) : Math.floor(py);
      if (!discreteDirAt(field, sc, goal, cx, cy, smoothScratch)) {
        return null;
      }
      const d0x = smoothScratch.dx;
      const d0y = smoothScratch.dy;
      if (d0x === 0 && d0y === 0) {
        return smoothScratch;
      }
      const width = terrain.width;
      const height = terrain.height;

      // Stage 1: Full-map seamless 2x2 dual-quad bilinear gradient.
      const halfOffset = isHeavy ? 1 : 0.5;
      const x00 = px >= cx + halfOffset ? cx : cx - 1;
      const y00 = py >= cy + halfOffset ? cy : cy - 1;
      if (ensureStage1Quad(field, sc, x00, y00)) {
        const i00 = y00 * width + x00;
        const c00 = field.u[i00] as number;
        const c10 = field.u[i00 + 1] as number;
        const c01 = field.u[i00 + width] as number;
        const c11 = field.u[i00 + width + 1] as number;
        const tx = Math.max(0, Math.min(1, px - (x00 + halfOffset)));
        const ty = Math.max(0, Math.min(1, py - (y00 + halfOffset)));
        const gx = (1 - ty) * (c00 - c10) + ty * (c01 - c11);
        const gy = (1 - tx) * (c00 - c01) + tx * (c10 - c11);
        if (gx * d0x + gy * d0y > 0) {
          const len = Math.sqrt(gx * gx + gy * gy);
          if (len > 0) {
            smoothScratch.dx = gx / len;
            smoothScratch.dy = gy / len;
            return smoothScratch;
          }
        }
      }

      // Stage 2: Full-map safe cardinal central difference.
      if (cx >= 1 && cx + 1 < width && cy >= 1 && cy + 1 < height) {
        const cIdx = cy * width + cx;
        let cFlags = field.quadFlags[cIdx] as number;
        if ((cFlags & STAGE2_CARD_DONE) === 0) {
          const cW = costAtCell(field, sc, cx - 1, cy);
          const cE = costAtCell(field, sc, cx + 1, cy);
          const cN = costAtCell(field, sc, cx, cy - 1);
          const cS = costAtCell(field, sc, cx, cy + 1);
          const ok =
            cW < INF &&
            cE < INF &&
            cN < INF &&
            cS < INF &&
            ((sc.dirMask[cIdx] as number) & 15) === 15;
          cFlags |= STAGE2_CARD_DONE | (ok ? STAGE2_CARD_OK : 0);
          field.quadFlags[cIdx] = cFlags;
        }
        if ((cFlags & STAGE2_CARD_OK) !== 0) {
          const cW = field.u[cIdx - 1] as number;
          const cE = field.u[cIdx + 1] as number;
          const cN = field.u[cIdx - width] as number;
          const cS = field.u[cIdx + width] as number;
          const gx = cW - cE;
          const gy = cN - cS;
          const sx = gx > 0 ? 1 : gx < 0 ? -1 : 0;
          const sy = gy > 0 ? 1 : gy < 0 ? -1 : 0;
          if (
            gx * d0x + gy * d0y > 0 &&
            (sx !== 0 || sy !== 0) &&
            terrain.stepCost(cx, cy, cx + sx, cy + sy, goal.cls, goal.tier) >= 0
          ) {
            const len = Math.sqrt(gx * gx + gy * gy);
            if (len > 0) {
              smoothScratch.dx = gx / len;
              smoothScratch.dy = gy / len;
              return smoothScratch;
            }
          }
        }
      }

      // Stage 3: Safe discrete unit fallback.
      const len = Math.sqrt(d0x * d0x + d0y * d0y);
      if (len > 0) {
        smoothScratch.dx = d0x / len;
        smoothScratch.dy = d0y / len;
      }
      return smoothScratch;
    },

    invalidateCells(cells) {
      for (const sc of slotCaches) {
        sc?.invalidate(cells);
      }
      recycleAllFields();
    },
  };

  const module: SimModule = {
    id: 'frontline_td:pathing',
    install(builder) {
      builder.state('frontline_td:pathing.goals', {
        save(): Serializable {
          const entries: {
            id: number;
            x: number;
            y: number;
            cls: number;
            ref: number;
            tier?: number;
          }[] = [];
          for (let id = 0; id < goalSlots.length; id++) {
            const g = goalSlots[id];
            if (g === undefined) {
              continue;
            }
            entries.push(
              g.tier === STD_TIER
                ? { id, x: g.x, y: g.y, cls: g.cls, ref: g.refcount }
                : { id, x: g.x, y: g.y, cls: g.cls, ref: g.refcount, tier: g.tier },
            );
          }
          return { nextId, freeIds: [...freeIds], entries };
        },
        load(data: Serializable): void {
          const saved = data as {
            nextId: number;
            freeIds: number[];
            entries: {
              id: number;
              x: number;
              y: number;
              cls: number;
              ref: number;
              tier?: number;
            }[];
          };
          goalSlots.length = 0;
          goalByKey.clear();
          freeIds.length = 0;
          freeIds.push(...saved.freeIds);
          nextId = saved.nextId;
          for (const entry of saved.entries) {
            const rawTier = entry.tier ?? STD_TIER;
            const tier: ClearanceTier = rawTier === HEAVY_TIER ? HEAVY_TIER : STD_TIER;
            goalSlots[entry.id] = {
              x: entry.x,
              y: entry.y,
              cls: entry.cls,
              tier,
              refcount: entry.ref,
            };
            goalByKey.set(goalKey(entry.x, entry.y, entry.cls, tier), entry.id);
          }
          // The blocked overlay may differ from construction time: reset all
          // derived caches against the restored terrain.
          resetCaches();
        },
      });
    },
  };
  return { module, api };
}
