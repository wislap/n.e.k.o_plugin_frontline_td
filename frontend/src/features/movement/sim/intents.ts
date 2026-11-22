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
  clearanceAnchorCell,
  clearanceAnchorCenter,
  clearanceTierForRadius,
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
import { lineWalkable } from './line';
import {
  assignClusterRoutes,
  releaseRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
} from './route-chain';
import { assignSlots, collectSlots } from './slots';
import {
  COMMAND_SNAP_RING,
  groupByClassAndTier,
  type MoveGroup,
  resolveTierTarget,
  resolveUnifiedIntentGroups,
} from './target-resolve';

const HEAVY_TIER = CLEARANCE_HEAVY;

type TgtView = WriteView<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8'; stall: 'u8' }>;
type TgtWriter = ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8'; stall: 'u8' }>;
type GuideView = WriteView<{ maxSpeed: 'f64'; active: 'u8' }>;
type GuideWriter = ComponentWriter<{ maxSpeed: 'f64'; active: 'u8' }>;
type RouteFollowWriter = ComponentWriter<{
  chain: 'u32';
  gate: 'u16';
  lane: 'f64';
  active: 'u8';
}>;

export function clearFormationGuide(guide: GuideView, id: number): void {
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

// Shared goal/slot assignment used by MoveCommand and the move intent:
// release each unit's old goal, acquire one shared goal for (cls, tier),
// write slot targets, and assign watershed-proof cluster corridor chains.
function applyMoveGroup(
  ctx: SystemContext,
  terrain: TerrainApi,
  pathing: PathingApi,
  routes: RouteChainStore,
  tgtW: TgtWriter,
  guideW: GuideWriter,
  routeW: RouteFollowWriter,
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
  const routeOut = ctx.write(routeW) as RouteFollowView;
  const pos = ctx.read(Position);
  const mover = ctx.read(Mover);
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
  let resolvedMap: ReadonlyMap<number, { x: number; y: number }>;
  if (explicitSlots !== undefined && clsIds.every((id) => explicitSlots.has(id))) {
    const checked = new Map<number, { x: number; y: number }>();
    for (const id of clsIds) {
      const uTier = clearanceTierForRadius(mover.radius[id] ?? 0);
      const s = explicitSlots.get(id);
      const dest =
        s !== undefined &&
        terrain.inBounds(Math.floor(s.x), Math.floor(s.y)) &&
        terrain.passable(
          clearanceAnchorCell(s.x, uTier),
          clearanceAnchorCell(s.y, uTier),
          cls,
          uTier,
        )
          ? s
          : fallback;
      out.goal[id] = goal;
      out.x[id] = dest.x;
      out.y[id] = dest.y;
      out.active[id] = 1;
      out.stall[id] = 0;
      checked.set(id, dest);
    }
    resolvedMap = checked;
  } else {
    const slots = collectSlots(
      terrain,
      (sx, sy) =>
        lineWalkable(
          terrain,
          cls,
          fallback.x,
          fallback.y,
          clearanceAnchorCenter(sx, tier),
          clearanceAnchorCenter(sy, tier),
          tier,
        ),
      cls,
      x,
      y,
      clsIds.length,
      tier,
    );
    if (slots.length < clsIds.length) {
      const step = tier === HEAVY_TIER ? 2 : 1;
      const extra = collectSlots(
        terrain,
        (sx, sy) => pathing.directionAt(goal, sx, sy) !== null,
        cls,
        x,
        y,
        clsIds.length,
        tier,
      );
      for (const c of extra) {
        if (slots.length >= clsIds.length) {
          break;
        }
        if (!slots.some((s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y)) < step)) {
          slots.push(c);
        }
      }
    }
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
      out.stall[id] = 0;
    }
    resolvedMap = assignment;
  }
  if (clsIds.length > 0 && goal >= 0) {
    assignClusterRoutes(
      routes,
      terrain,
      pathing,
      pos,
      routeOut,
      clsIds,
      cls,
      tier,
      goal,
      x,
      y,
      resolvedMap,
      fallback,
    );
  }
}

export function installMovementIntents(
  builder: SimBuilder,
  terrain: TerrainApi,
  pathing: PathingApi,
  routes: RouteChainStore,
  tgtW: TgtWriter,
  guideW: GuideWriter,
  routeW: RouteFollowWriter,
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
        const seen = new Set<number>();
        let explicitSlots: Map<number, { x: number; y: number }> | undefined;
        const pSlots = p.slots;
        for (let i = 0; i < p.units.length; i++) {
          const h = p.units[i];
          const id = ctx.resolve(h as EntityHandle);
          if (id !== null && ctx.has(Mover, id) && !seen.has(id)) {
            seen.add(id);
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
        // Unified mixed-tier routing for MoveIntent: keep heavy + heavy-reachable
        // standard units on one shared heavy goal & corridor chain to prevent
        // 1-cell shortcut splitting.
        const pos = ctx.read(Position);
        const resolved = resolveUnifiedIntentGroups(terrain, pathing, pos, mover, ids, p.x, p.y);
        for (const { group, targetCell } of resolved) {
          applyMoveGroup(
            ctx,
            terrain,
            pathing,
            routes,
            tgtW,
            guideW,
            routeW,
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
        const routeOut = ctx.write(routeW) as RouteFollowView;
        for (const h of p.units) {
          const id = ctx.resolve(h as EntityHandle);
          if (id === null || !ctx.has(Mover, id)) {
            continue;
          }
          releaseHeldGoal(pathing, target, id);
          clearFormationGuide(guideOut, id);
          releaseRouteFollow(routes, routeOut, id);
          out.goal[id] = 0;
          out.active[id] = 0;
          out.stall[id] = 0;
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
          guideOut.maxSpeed[id] = Math.max(0, p.maxSpeeds?.[i] ?? 0);
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
      const seen = new Set<number>();
      for (const handle of payload.units) {
        const id = ctx.resolve(handle);
        if (id === null || !ctx.ownedBy(handle, issuer) || !ctx.has(Mover, id) || seen.has(id)) {
          continue;
        }
        seen.add(id);
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
          COMMAND_SNAP_RING,
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
          routes,
          tgtW,
          guideW,
          routeW,
          group.ids,
          group.cls,
          group.tier,
          targetCell.x,
          targetCell.y,
        );
      }
      // Player override signal (squads drop these members): only the
      // command emits this; intent-driven moves do not.
      ctx.emit(MoveOrdered, { units: ids.map((id) => Number(ctx.handleOf(id as EntityId))) });
    },
    { emits: [MoveOrdered] },
  );
}
