// Target snapping & unified mixed-tier move grouping helpers (movement/sim internal).
import type { ReadonlyNumberArray } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  clearanceTierForRadius,
  spiralOffsets,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';

const STD_TIER = CLEARANCE_STANDARD;
const HEAVY_TIER = CLEARANCE_HEAVY;

const INTENT_SNAP_RING = 32;
export const COMMAND_SNAP_RING = 3;

const HEAVY_COVER_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export interface MoveGroup {
  cls: number;
  tier: ClearanceTier;
  ids: number[];
}

function snapReachable(
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  cls: number,
  tier: ClearanceTier,
  ids: readonly number[],
  x: number,
  y: number,
  maxRing: number,
): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as number;
    sx += pos.x[id] ?? 0;
    sy += pos.y[id] ?? 0;
  }
  const n = Math.max(1, ids.length);
  const gcx = sx / n;
  const gcy = sy / n;

  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  let stopRing = maxRing;

  for (const [dx, dy] of spiralOffsets(cx, cy, terrain.width, terrain.height)) {
    const ring = Math.max(Math.abs(dx), Math.abs(dy));
    if (ring > stopRing) {
      break;
    }
    const tx = cx + dx;
    const ty = cy + dy;
    if (!terrain.passable(tx, ty, cls, tier)) {
      continue;
    }
    const ok = ids.some((id) =>
      pathing.reachable(
        clearanceAnchorCell(pos.x[id] ?? 0, tier),
        clearanceAnchorCell(pos.y[id] ?? 0, tier),
        tx,
        ty,
        cls,
        tier,
      ),
    );
    if (!ok) {
      continue;
    }
    if (best === null && maxRing > COMMAND_SNAP_RING) {
      stopRing = Math.min(maxRing, ring + 1);
    }
    const candCx = clearanceAnchorCenter(tx, tier);
    const candCy = clearanceAnchorCenter(ty, tier);
    const fdx = candCx - gcx;
    const fdy = candCy - gcy;
    const score = (dx * dx + dy * dy) * 1024 + (fdx * fdx + fdy * fdy);
    if (score < bestScore) {
      bestScore = score;
      best = { x: tx, y: ty };
    }
  }
  return best;
}

export function resolveTierTarget(
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  cls: number,
  tier: ClearanceTier,
  ids: readonly number[],
  x: number,
  y: number,
  maxSnapRing: number,
): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (tier === STD_TIER) {
    if (terrain.passable(cx, cy, cls, STD_TIER)) {
      return { x: cx, y: cy };
    }
    return maxSnapRing > 0
      ? snapReachable(terrain, pathing, pos, cls, tier, ids, cx, cy, maxSnapRing)
      : null;
  }
  for (const [ox, oy] of HEAVY_COVER_OFFSETS) {
    const ax = cx - ox;
    const ay = cy - oy;
    if (terrain.passable(ax, ay, cls, HEAVY_TIER)) {
      return { x: ax, y: ay };
    }
  }
  const heavyRing = Math.max(
    maxSnapRing,
    terrain.passable(cx, cy, cls, STD_TIER) ? INTENT_SNAP_RING : maxSnapRing,
  );
  return heavyRing > 0
    ? snapReachable(terrain, pathing, pos, cls, HEAVY_TIER, ids, cx, cy, heavyRing)
    : null;
}

export function groupByClassAndTier(
  ids: readonly number[],
  mover: { cls: ReadonlyNumberArray; radius: ReadonlyNumberArray },
): MoveGroup[] {
  const groups: MoveGroup[] = [];
  const byKey = new Map<number, MoveGroup>();
  for (const id of ids) {
    const cls = mover.cls[id] ?? 0;
    const tier = clearanceTierForRadius(mover.radius[id] ?? 0);
    const key = tier * 1024 + cls;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { cls, tier, ids: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.ids.push(id);
  }
  return groups;
}

export function resolveUnifiedIntentGroups(
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  mover: { cls: ReadonlyNumberArray; radius: ReadonlyNumberArray },
  ids: readonly number[],
  px: number,
  py: number,
): { group: MoveGroup; targetCell: { x: number; y: number } }[] {
  const byCls = new Map<number, { std: number[]; heavy: number[] }>();
  for (const id of ids) {
    const cls = mover.cls[id] ?? 0;
    let entry = byCls.get(cls);
    if (entry === undefined) {
      entry = { std: [], heavy: [] };
      byCls.set(cls, entry);
    }
    if (clearanceTierForRadius(mover.radius[id] ?? 0) === HEAVY_TIER) {
      entry.heavy.push(id);
    } else {
      entry.std.push(id);
    }
  }
  const resolved: { group: MoveGroup; targetCell: { x: number; y: number } }[] = [];
  for (const [cls, bucket] of byCls) {
    if (bucket.heavy.length > 0 && bucket.std.length > 0) {
      const heavyTarget = resolveTierTarget(
        terrain,
        pathing,
        pos,
        cls,
        HEAVY_TIER,
        bucket.heavy,
        px,
        py,
        INTENT_SNAP_RING,
      );
      if (heavyTarget !== null) {
        const cohesiveStd: number[] = [];
        const isolatedStd: number[] = [];
        for (const id of bucket.std) {
          const ux = Math.floor(pos.x[id] ?? 0);
          const uy = Math.floor(pos.y[id] ?? 0);
          let inHeavyBasin = false;
          for (const [ox, oy] of HEAVY_COVER_OFFSETS) {
            const ax = ux - ox;
            const ay = uy - oy;
            if (
              terrain.inBounds(ax, ay) &&
              terrain.passable(ax, ay, cls, HEAVY_TIER) &&
              pathing.reachable(ax, ay, heavyTarget.x, heavyTarget.y, cls, HEAVY_TIER)
            ) {
              inHeavyBasin = true;
              break;
            }
          }
          if (inHeavyBasin) {
            cohesiveStd.push(id);
          } else {
            isolatedStd.push(id);
          }
        }
        resolved.push({
          group: { cls, tier: HEAVY_TIER, ids: [...bucket.heavy, ...cohesiveStd] },
          targetCell: heavyTarget,
        });
        if (isolatedStd.length > 0) {
          const stdTarget = resolveTierTarget(
            terrain,
            pathing,
            pos,
            cls,
            STD_TIER,
            isolatedStd,
            px,
            py,
            INTENT_SNAP_RING,
          );
          if (stdTarget !== null) {
            resolved.push({
              group: { cls, tier: STD_TIER, ids: isolatedStd },
              targetCell: stdTarget,
            });
          }
        }
        continue;
      }
    }
    if (bucket.heavy.length > 0) {
      const targetCell = resolveTierTarget(
        terrain,
        pathing,
        pos,
        cls,
        HEAVY_TIER,
        bucket.heavy,
        px,
        py,
        INTENT_SNAP_RING,
      );
      if (targetCell !== null) {
        resolved.push({ group: { cls, tier: HEAVY_TIER, ids: bucket.heavy }, targetCell });
      }
    }
    if (bucket.std.length > 0) {
      const targetCell = resolveTierTarget(
        terrain,
        pathing,
        pos,
        cls,
        STD_TIER,
        bucket.std,
        px,
        py,
        INTENT_SNAP_RING,
      );
      if (targetCell !== null) {
        resolved.push({ group: { cls, tier: STD_TIER, ids: bucket.std }, targetCell });
      }
    }
  }
  return resolved;
}
