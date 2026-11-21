// Move/stop intent resolution and the MoveCommand handler — one shared
// applyMoveGroup path: release old goals, acquire one shared goal per
// (class, tier) group, write slot targets. Intents resolve at
// movement-phase start in emission order; a command additionally emits
// MoveOrdered (the player override signal squads listen to).
import type { EntityHandle, EntityId } from '../../../core/index';
import type { ComponentWriter, SimBuilder, SystemContext, WriteView } from '../../../kernel/index';
import type { ReadonlyNumberArray } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  clearanceTierForRadius,
  spiralOffsets,
  type ClearanceTier,
} from '../../terrain/rules/index';
import {
  FormationGuideIntent,
  MoveCommand,
  MoveIntent,
  MoveOrdered,
  StopIntent,
} from '../protocol';
import { FormationGuide, Mover, MoveTarget, Position } from './components';
import { assignSlots, collectSlots } from './slots';

type TgtView = WriteView<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8' }>;
type TgtWriter = ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8' }>;
type GuideView = WriteView<{ x: 'f64'; y: 'f64'; maxSpeed: 'f64'; active: 'u8' }>;
type GuideWriter = ComponentWriter<{ x: 'f64'; y: 'f64'; maxSpeed: 'f64'; active: 'u8' }>;

export function clearFormationGuide(guide: GuideView, id: number): void {
  guide.x[id] = 0;
  guide.y[id] = 0;
  guide.maxSpeed[id] = 0;
  guide.active[id] = 0;
}

// Release only a goal this unit still owns: active===1 holds a live
// reference; active===2 (holding the slot) and active===0 already
// released theirs, so releasing their stale `goal` field would
// decrement a refcount they no longer own.
export function releaseHeldGoal(
  pathing: PathingApi,
  tgt: { goal: ReadonlyNumberArray; active: ReadonlyNumberArray },
  id: number,
): void {
  if ((tgt.active[id] ?? 0) === 1) {
    pathing.releaseGoal(tgt.goal[id] ?? 0);
  }
}

// A move intent at an impassable cell snaps to the nearest passable,
// reachable cell within this ring (spiral order, first hit wins).
const SNAP_RING = 32;

const HEAVY_COVER_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

// Nearest cell for `(cls, tier)` around (x, y) that is both passable and
// reachable from at least one moving unit (spiral order, first hit):
// used by move intents and heavy-tier narrow-gap fallback. Commands
// reject impassable targets instead.
function snapReachable(
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  cls: number,
  tier: ClearanceTier,
  ids: readonly number[],
  x: number,
  y: number,
): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (const [dx, dy] of spiralOffsets(cx, cy, terrain.width, terrain.height)) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) > SNAP_RING) {
      break;
    }
    const tx = cx + dx;
    const ty = cy + dy;
    if (!terrain.passable(tx, ty, cls, tier)) {
      continue;
    }
    const goal = pathing.acquireGoal(tx, ty, cls, tier);
    const ok = ids.some(
      (id) =>
        pathing.directionAt(
          goal,
          clearanceAnchorCell(pos.x[id] ?? 0, tier),
          clearanceAnchorCell(pos.y[id] ?? 0, tier),
        ) !== null,
    );
    pathing.releaseGoal(goal);
    if (ok) {
      return { x: tx, y: ty };
    }
  }
  return null;
}

function resolveTierTarget(
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  cls: number,
  tier: ClearanceTier,
  ids: readonly number[],
  x: number,
  y: number,
  allowSnap: boolean,
): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (tier === CLEARANCE_STANDARD) {
    if (terrain.passable(cx, cy, cls, CLEARANCE_STANDARD)) {
      return { x: cx, y: cy };
    }
    return allowSnap ? snapReachable(terrain, pathing, pos, cls, tier, ids, cx, cy) : null;
  }
  for (const [ox, oy] of HEAVY_COVER_OFFSETS) {
    const ax = cx - ox;
    const ay = cy - oy;
    if (terrain.passable(ax, ay, cls, CLEARANCE_HEAVY)) {
      return { x: ax, y: ay };
    }
  }
  if (allowSnap || terrain.passable(cx, cy, cls, CLEARANCE_STANDARD)) {
    return snapReachable(terrain, pathing, pos, cls, CLEARANCE_HEAVY, ids, cx, cy);
  }
  return null;
}

interface MoveGroup {
  cls: number;
  tier: ClearanceTier;
  ids: number[];
}

function groupByClassAndTier(
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

// Shared goal/slot assignment used by MoveCommand and the move intent:
// release each unit's old goal, acquire one shared goal for (cls, tier),
// then write slot targets. Callers have already validated the target cell.
function applyMoveGroup(
  ctx: SystemContext,
  terrain: TerrainApi,
  pathing: PathingApi,
  tgtW: TgtWriter,
  guideW: GuideWriter,
  clsIds: readonly number[],
  cls: number,
  tier: ClearanceTier,
  x: number,
  y: number,
  explicitSlots?: ReadonlyMap<number, { x: number; y: number }>,
): void {
  const target = ctx.read(MoveTarget);
  const out = ctx.write(tgtW) as TgtView;
  const guideOut = ctx.write(guideW) as GuideView;
  const pos = ctx.read(Position);
  // Release old goals, clear stale formation guides, then one shared-goal
  // ref per unit (the goal id is the same for the whole (cls, tier) group).
  let goal = -1;
  for (const id of clsIds) {
    releaseHeldGoal(pathing, target, id);
    clearFormationGuide(guideOut, id);
    goal = pathing.acquireGoal(x, y, cls, tier);
  }
  const fallback = {
    x: clearanceAnchorCenter(x, tier),
    y: clearanceAnchorCenter(y, tier),
  };
  if (explicitSlots !== undefined && clsIds.every((id) => explicitSlots.has(id))) {
    for (const id of clsIds) {
      const s = explicitSlots.get(id);
      const dest =
        s !== undefined &&
        terrain.inBounds(Math.floor(s.x), Math.floor(s.y)) &&
        terrain.passable(clearanceAnchorCell(s.x, tier), clearanceAnchorCell(s.y, tier), cls, tier)
          ? s
          : fallback;
      out.goal[id] = goal;
      out.x[id] = dest.x;
      out.y[id] = dest.y;
      out.active[id] = 1;
    }
    return;
  }
  const slots = collectSlots(
    terrain,
    (sx, sy) => pathing.directionAt(goal, sx, sy) !== null,
    cls,
    x,
    y,
    clsIds.length,
    tier,
  );
  const assignment = assignSlots(
    clsIds.map((id) => ({ id, x: pos.x[id] ?? 0, y: pos.y[id] ?? 0 })),
    slots,
    tier,
  );
  for (const id of clsIds) {
    const slot = assignment.get(id) ?? fallback;
    out.goal[id] = goal;
    out.x[id] = slot.x;
    out.y[id] = slot.y;
    out.active[id] = 1;
  }
}

export function installMovementIntents(
  builder: SimBuilder,
  terrain: TerrainApi,
  pathing: PathingApi,
  tgtW: TgtWriter,
  guideW: GuideWriter,
): void {
  // Resolve move/stop/formation_guide intents first, in emission order; a
  // later move for the same unit overwrites the earlier one, and
  // FormationGuideIntent runs after MoveIntent/StopIntent so same-tick
  // squad updates land cleanly. Handle liveness and Mover are validated;
  // faction ownership is the emitter's responsibility.
  builder.system({
    id: 'frontline_td:movement.intents',
    phase: 'movement',
    reads: [MoveIntent, StopIntent, FormationGuideIntent],
    run(ctx) {
      const mover = ctx.read(Mover);
      const target = ctx.read(MoveTarget);
      for (const p of ctx.read(MoveIntent)) {
        const ids: number[] = [];
        let explicitSlots: Map<number, { x: number; y: number }> | undefined;
        const pSlots = p.slots;
        for (let i = 0; i < p.units.length; i++) {
          const h = p.units[i];
          const id = ctx.resolve(h as EntityHandle);
          if (id !== null && ctx.has(Mover, id) && !ids.includes(id)) {
            ids.push(id);
            if (pSlots !== undefined && i < pSlots.length) {
              const slot = pSlots[i];
              if (slot !== undefined) {
                explicitSlots ??= new Map();
                explicitSlots.set(id, slot);
              }
            }
          }
        }
        if (ids.length === 0 || !terrain.inBounds(p.x, p.y)) {
          continue;
        }
        // Per-(class, tier): an impassable target cell snaps to the nearest
        // passable cell the group can reach (intents aim at points — e.g.
        // a structure's blocked centre); commands instead reject impassable
        // targets outright.
        const groups = groupByClassAndTier(ids, mover);
        const pos = ctx.read(Position);
        const resolved: { group: MoveGroup; targetCell: { x: number; y: number } }[] = [];
        for (const group of groups) {
          const targetCell = resolveTierTarget(
            terrain,
            pathing,
            pos,
            group.cls,
            group.tier,
            group.ids,
            p.x,
            p.y,
            true,
          );
          if (targetCell !== null) {
            resolved.push({ group, targetCell });
          }
        }
        for (const { group, targetCell } of resolved) {
          applyMoveGroup(
            ctx,
            terrain,
            pathing,
            tgtW,
            guideW,
            group.ids,
            group.cls,
            group.tier,
            targetCell.x,
            targetCell.y,
            explicitSlots,
          );
        }
      }
      for (const p of ctx.read(StopIntent)) {
        const out = ctx.write(tgtW) as TgtView;
        const guideOut = ctx.write(guideW) as GuideView;
        for (const h of p.units) {
          const id = ctx.resolve(h as EntityHandle);
          if (id === null || !ctx.has(Mover, id)) {
            continue;
          }
          releaseHeldGoal(pathing, target, id);
          clearFormationGuide(guideOut, id);
          out.goal[id] = 0;
          out.active[id] = 0;
        }
      }
      for (const p of ctx.read(FormationGuideIntent)) {
        const guideOut = ctx.write(guideW) as GuideView;
        for (let i = 0; i < p.units.length; i++) {
          const h = p.units[i];
          const id = ctx.resolve(h as EntityHandle);
          if (id === null || !ctx.has(Mover, id) || !ctx.has(FormationGuide, id)) {
            continue;
          }
          if (!p.active) {
            clearFormationGuide(guideOut, id);
            continue;
          }
          const wp = p.waypoints?.[i];
          if (wp === undefined || !terrain.inBounds(Math.floor(wp.x), Math.floor(wp.y))) {
            clearFormationGuide(guideOut, id);
            continue;
          }
          guideOut.x[id] = wp.x;
          guideOut.y[id] = wp.y;
          guideOut.maxSpeed[id] = Math.max(0, wp.maxSpeed ?? 0);
          guideOut.active[id] = 1;
        }
      }
    },
  });

  builder.command(
    MoveCommand,
    (ctx, payload, issuer) => {
      if (!terrain.inBounds(payload.x, payload.y)) {
        ctx.reject('invalid_target');
        return;
      }
      // Validate before mutating: a mid-loop reject must not leave earlier
      // units with acquired goals or a half-applied order.
      const mover = ctx.read(Mover);
      const ids: number[] = [];
      for (const handle of payload.units) {
        const id = ctx.resolve(handle);
        if (
          id === null ||
          !ctx.ownedBy(handle, issuer) ||
          !ctx.has(Mover, id) ||
          ids.includes(id)
        ) {
          continue;
        }
        ids.push(id);
      }
      if (ids.length === 0) {
        ctx.reject('no_units');
        return;
      }
      const groups = groupByClassAndTier(ids, mover);
      const pos = ctx.read(Position);
      const resolved: { group: MoveGroup; targetCell: { x: number; y: number } }[] = [];
      for (const group of groups) {
        const targetCell = resolveTierTarget(
          terrain,
          pathing,
          pos,
          group.cls,
          group.tier,
          group.ids,
          payload.x,
          payload.y,
          false,
        );
        if (targetCell === null) {
          ctx.reject('invalid_target');
          return;
        }
        resolved.push({ group, targetCell });
      }
      for (const { group, targetCell } of resolved) {
        applyMoveGroup(
          ctx,
          terrain,
          pathing,
          tgtW,
          guideW,
          group.ids,
          group.cls,
          group.tier,
          targetCell.x,
          targetCell.y,
        );
      }
      const guideOut = ctx.write(guideW) as GuideView;
      for (const id of ids) {
        clearFormationGuide(guideOut, id);
      }
      // Player override signal (squads drop these members): only the
      // command emits this; intent-driven moves do not.
      ctx.emit(MoveOrdered, { units: ids.map((id) => Number(ctx.handleOf(id as EntityId))) });
    },
    { emits: [MoveOrdered] },
  );
}
