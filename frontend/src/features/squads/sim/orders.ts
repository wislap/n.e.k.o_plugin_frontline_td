// Per-squad orders update (called on the squad's stagger slot):
// resupply, gather launch, engage split, advance arrival and
// blocked-route retargeting, guard return, persistent role formations,
// 1D geodesic cruise pacing, and stray recovery.
import { distance } from '../../../core/index';
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import { MoveIntent, StopIntent } from '../../movement/protocol';
import { Mover, MoveTarget, Position } from '../../movement/sim/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCenter,
} from '../../terrain/rules/index';
import { SquadsLaunched } from '../protocol';
import type { SquadsDeps } from './deps';
import { meanEnergyBp } from './energy';
import {
  computeFormationLayout,
  markFootprintCells,
  projectSurroundArcSlots,
  type FormationMemberInfo,
} from './formation';
import { nearestCovered, retargetStructure } from './routing';
import type { Squad, SquadSlot, SquadsEnv } from './state';
import {
  ARRIVE_DIST,
  SQUAD_PERIOD,
  STRAY_DIST,
  acquireProbeWithFallback,
  collectMemberInfos,
  emitTransitGuide,
  ensureSquadSlotsAndEmitMove,
  isGoalReachableWithFallback,
  releaseGuideIfActive,
  squadGoalTier,
} from './transit';

export { SQUAD_PERIOD };

const ENGAGE_RADIUS = 8;
const REGOAL_DRIFT = 2;
const LEASH_EXTRA = 4;
const RESUPPLY_LEAVE_BP = 3000;
const RESUPPLY_RETURN_BP = 8000;
const RETARGET_PERIOD = 40;

function centroid(ctx: SystemContext, ids: readonly number[]): { x: number; y: number } {
  const pos = ctx.read(Position);
  let x = 0;
  let y = 0;
  for (const id of ids) {
    x += pos.x[id] ?? 0;
    y += pos.y[id] ?? 0;
  }
  const n = Math.max(1, ids.length);
  return { x: x / n, y: y / n };
}

// Move-intent dedupe for engaging fallback moves.
function needsMove(ctx: SystemContext, ids: readonly number[], px: number, py: number): boolean {
  const pos = ctx.read(Position);
  const tgt = ctx.read(MoveTarget);
  for (const id of ids) {
    if (
      (tgt.active[id] ?? 0) === 0 &&
      distance(0, 0, (pos.x[id] ?? 0) - px, (pos.y[id] ?? 0) - py) > ARRIVE_DIST
    ) {
      return true;
    }
  }
  return false;
}

// One staggered update of a single squad. Emits movement intents only.
export function updateSquad(
  ctx: SystemContext,
  env: SquadsEnv,
  deps: SquadsDeps,
  squad: Squad,
): void {
  const pos = ctx.read(Position);
  const mover = ctx.read(Mover);

  // Drop dead members; empty squads are deleted (a gathering squad
  // persists until launch).
  const alive = squad.members.filter((h) => ctx.resolve(h as EntityHandle) !== null);
  if (alive.length !== squad.members.length) {
    squad.members = alive;
  }
  if (
    squad.members.length === 0 &&
    !(squad.order.kind === 'gather' && ctx.tick < (squad.order.launchTick ?? 0))
  ) {
    env.squads.delete(squad.id);
    return;
  }
  if (squad.members.length === 0) {
    return;
  }
  const ids = squad.members
    .map((h) => ctx.resolve(h as EntityHandle))
    .filter((id): id is EntityId => id !== null);
  const c = centroid(ctx, ids);
  const memberInfos = collectMemberInfos(ctx, deps, ids);

  // Gather launch is a scheduled order transition: it fires before
  // resupply so a drained squad still launches on time.
  if (squad.order.kind === 'gather' && ctx.tick >= (squad.order.launchTick ?? 0)) {
    const g = squad.order;
    squad.order = {
      kind: 'advance',
      x: g.targetX ?? g.x,
      y: g.targetY ?? g.y,
      radius: 0,
    };
    squad.phase = 'moving';
    delete squad.heading;
    delete squad.slots;
    releaseGuideIfActive(ctx, squad);
    ctx.emit(SquadsLaunched, {
      squad: squad.id,
      faction: squad.faction,
      x: squad.order.x,
      y: squad.order.y,
    });
  }

  // Resupply: squads with batteries retreat to the nearest own
  // covered cell while their mean energy is below the threshold.
  const bp = meanEnergyBp(ctx, ids, deps.energyCargo);
  if (bp !== null && squad.phase === 'resupplying' && bp >= RESUPPLY_RETURN_BP) {
    squad.phase = 'returning';
  } else if (bp !== null && bp < RESUPPLY_LEAVE_BP && squad.phase !== 'resupplying') {
    squad.phase = 'resupplying';
  }
  if (squad.phase === 'resupplying') {
    releaseGuideIfActive(ctx, squad);
    // Re-evaluated every update: coverage can appear later, and
    // the nearest covered cell shifts as the squad moves.
    const cell = nearestCovered(ctx, deps, squad.faction as FactionId, c.x, c.y);
    if (cell !== null) {
      ensureSquadSlotsAndEmitMove(ctx, deps, squad, memberInfos, c, cell.x, cell.y);
    }
    return;
  }

  // Gather: sit at the gather point until launchTick (handled above —
  // a just-launched squad falls through to the advance path).
  const order = squad.order;
  if (order.kind === 'gather') {
    if (squad.phase !== 'holding') {
      squad.phase = 'moving';
    }
    if (distance(0, 0, order.x - c.x, order.y - c.y) > ARRIVE_DIST) {
      ensureSquadSlotsAndEmitMove(ctx, deps, squad, memberInfos, c, order.x, order.y);
      emitTransitGuide(ctx, deps, squad, memberInfos, c, order.x, order.y);
    } else {
      squad.phase = 'holding';
      releaseGuideIfActive(ctx, squad);
    }
    return;
  }

  const goalX = order.x;
  const goalY = order.y;
  const engageRadius = order.kind === 'guard' ? order.radius : ENGAGE_RADIUS;
  const ax = order.kind === 'guard' ? order.x : c.x;
  const ay = order.kind === 'guard' ? order.y : c.y;
  const wasEngaging = squad.phase === 'engaging';
  // Guard retention: keep chasing the engaged target while it
  // stays inside the leash (radius + LEASH_EXTRA); new targets
  // are acquired only inside the guard radius.
  let hostile: EntityId | null = null;
  if (order.kind === 'guard' && squad.engage !== undefined) {
    const id = ctx.resolve(squad.engage as EntityHandle);
    const fac = ctx.read(Faction);
    if (
      id !== null &&
      ctx.has(Faction, id) &&
      ctx.isHostile(squad.faction as FactionId, (fac.id[id] ?? 0) as FactionId) &&
      distance(0, 0, (pos.x[id] ?? 0) - order.x, (pos.y[id] ?? 0) - order.y) <=
        order.radius + LEASH_EXTRA
    ) {
      hostile = id;
    } else {
      delete squad.engage;
      squad.phase = 'returning';
    }
  }
  if (hostile === null) {
    hostile = deps.combat.nearestHostile(ctx, squad.faction as FactionId, ax, ay, engageRadius);
    if (hostile !== null && order.kind === 'guard') {
      squad.engage = Number(ctx.handleOf(hostile));
    }
  }

  if (hostile !== null) {
    releaseGuideIfActive(ctx, squad);
    delete squad.heading;
    const hx = pos.x[hostile] ?? 0;
    const hy = pos.y[hostile] ?? 0;
    squad.phase = 'engaging';
    const infoById = new Map<EntityId, FormationMemberInfo>();
    for (const m of memberInfos) {
      infoById.set(m.id, m);
    }
    // Engage split: members in weapon range stop, the rest move.
    const stop: EntityId[] = [];
    const move: EntityId[] = [];
    for (const id of ids) {
      // Same reach test combat fires with (range minus target radius).
      (deps.combat.inWeaponReach(ctx, id) ? stop : move).push(id);
    }
    // Stop only members that still hold a goal — re-stopping an idle
    // member is a no-op intent that churns nothing but the event list.
    const moving = ctx.read(MoveTarget);
    const needStop = stop.filter((id) => (moving.active[id] ?? 0) !== 0);
    if (needStop.length > 0) {
      ctx.emit(StopIntent, {
        units: needStop.map((id) => Number(ctx.handleOf(id))),
      });
    }
    if (
      move.length > 0 &&
      (distance(0, 0, hx - squad.lastGoal.x, hy - squad.lastGoal.y) >= REGOAL_DRIFT ||
        needsMove(ctx, move, hx, hy))
    ) {
      const reservedCells = new Set<number>();
      for (const id of stop) {
        const m = infoById.get(id);
        if (m !== undefined) {
          markFootprintCells(
            reservedCells,
            deps.terrain.width,
            deps.terrain.height,
            m.x,
            m.y,
            m.tier,
          );
        }
      }
      const moveInfos = move
        .map((id) => infoById.get(id))
        .filter((m): m is FormationMemberInfo => m !== undefined);
      const layout = computeFormationLayout(moveInfos);
      const moveCls = moveInfos[0]?.cls ?? 0;
      const moveSingleCls = moveInfos.every((m) => m.cls === moveCls);
      const moveTier = squadGoalTier(moveInfos);
      const probe = moveSingleCls
        ? acquireProbeWithFallback(deps.terrain, deps.pathing, moveCls, moveTier, hx, hy, c.x, c.y)
        : null;
      try {
        const projX = probe !== null ? clearanceAnchorCenter(probe.gx, probe.tier) : hx;
        const projY = probe !== null ? clearanceAnchorCenter(probe.gy, probe.tier) : hy;
        const slotsMap = projectSurroundArcSlots(
          deps.terrain,
          deps.pathing,
          probe?.goalId ?? null,
          hx,
          hy,
          c.x,
          c.y,
          moveInfos,
          layout.offsets,
          reservedCells,
        );
        const moveHandles: number[] = [];
        const moveSlots: { x: number; y: number }[] = [];
        for (const m of moveInfos) {
          moveHandles.push(m.handle);
          moveSlots.push(slotsMap.get(m.handle) ?? { x: projX, y: projY });
        }
        ctx.emit(MoveIntent, {
          units: moveHandles,
          x: probe !== null ? probe.gx : hx,
          y: probe !== null ? probe.gy : hy,
          slots: moveSlots,
        });
        squad.lastGoal = { x: hx, y: hy };
      } finally {
        if (probe !== null) {
          deps.pathing.releaseGoal(probe.goalId);
        }
      }
    }
    return;
  }

  let movedHandles = new Set<number>();

  // No hostile: advance arrives → guard; guard returns to point.
  if (order.kind === 'advance') {
    if (distance(0, 0, order.x - c.x, order.y - c.y) <= ARRIVE_DIST) {
      squad.order = { kind: 'guard', x: order.x, y: order.y, radius: 6 };
      squad.phase = 'holding';
      releaseGuideIfActive(ctx, squad);
      return;
    }
    // Re-check the original goal's reachability in O(1) via component
    // connectivity — a route walled off mid-advance must still be caught
    // without allocating or solving a probe GoalField.
    const cls = mover.cls[ids[0] ?? 0] ?? 0;
    const probeTier = squadGoalTier(memberInfos);
    const reachable = isGoalReachableWithFallback(
      deps.terrain,
      deps.pathing,
      cls,
      probeTier,
      goalX,
      goalY,
      memberInfos,
      c,
    );
    if (reachable) {
      // Route open (again): head for the real target — ensureSquadSlotsAndEmitMove
      // no-ops when the squad already holds it.
      squad.phase = 'moving';
      delete squad.retarget;
      movedHandles = ensureSquadSlotsAndEmitMove(
        ctx,
        deps,
        squad,
        memberInfos,
        c,
        goalX,
        goalY,
        wasEngaging,
      );
      emitTransitGuide(ctx, deps, squad, memberInfos, c, goalX, goalY);
    } else if (squad.retarget === undefined || ctx.tick - squad.retarget >= RETARGET_PERIOD) {
      // Blocked route: retarget to the nearest reachable hostile
      // structure, at most once per RETARGET_PERIOD. The squad keeps
      // marching on lastGoal between retargets.
      squad.retarget = ctx.tick;
      let next = retargetStructure(ctx, deps, squad.faction as FactionId, cls, c.x, c.y, probeTier);
      if (next === null && probeTier === CLEARANCE_HEAVY) {
        next = retargetStructure(
          ctx,
          deps,
          squad.faction as FactionId,
          cls,
          c.x,
          c.y,
          CLEARANCE_STANDARD,
        );
      }
      if (next === null) {
        squad.phase = 'holding';
        releaseGuideIfActive(ctx, squad);
      } else {
        squad.phase = 'moving';
        movedHandles = ensureSquadSlotsAndEmitMove(
          ctx,
          deps,
          squad,
          memberInfos,
          c,
          next.x,
          next.y,
          wasEngaging,
        );
        emitTransitGuide(ctx, deps, squad, memberInfos, c, next.x, next.y);
      }
    }
  } else if (order.kind === 'guard') {
    const far = ids.some(
      (id) => distance(0, 0, (pos.x[id] ?? 0) - order.x, (pos.y[id] ?? 0) - order.y) > order.radius,
    );
    if (far || squad.phase === 'returning' || wasEngaging) {
      if (distance(0, 0, order.x - c.x, order.y - c.y) > ARRIVE_DIST) {
        squad.phase = 'moving';
        movedHandles = ensureSquadSlotsAndEmitMove(
          ctx,
          deps,
          squad,
          memberInfos,
          c,
          order.x,
          order.y,
          wasEngaging,
        );
        emitTransitGuide(ctx, deps, squad, memberInfos, c, order.x, order.y);
      } else {
        squad.phase = 'holding';
        releaseGuideIfActive(ctx, squad);
      }
    } else {
      squad.phase = 'holding';
      releaseGuideIfActive(ctx, squad);
    }
  }

  // Strays (>10 cells from the centroid, e.g. reinforcements) get
  // a move to their persistent squad slot. An idle squad has no goal —
  // lastGoal is still the (0,0) placeholder, so skip the recall.
  if (order.kind === 'idle') {
    releaseGuideIfActive(ctx, squad);
    return;
  }
  const slotByHandle = new Map<number, SquadSlot>();
  for (const s of squad.slots ?? []) {
    slotByHandle.set(s.handle, s);
  }
  const hasUnassignedStray = memberInfos.some(
    (m) =>
      !movedHandles.has(m.handle) &&
      distance(0, 0, m.x - c.x, m.y - c.y) > STRAY_DIST &&
      !slotByHandle.has(m.handle),
  );
  if (hasUnassignedStray) {
    const goalTargetX = order.kind === 'guard' ? order.x : squad.lastGoal.x;
    const goalTargetY = order.kind === 'guard' ? order.y : squad.lastGoal.y;
    const newlyMoved = ensureSquadSlotsAndEmitMove(
      ctx,
      deps,
      squad,
      memberInfos,
      c,
      goalTargetX,
      goalTargetY,
    );
    for (const h of newlyMoved) {
      movedHandles.add(h);
    }
    slotByHandle.clear();
    for (const s of squad.slots ?? []) {
      slotByHandle.set(s.handle, s);
    }
  }
  const strays = memberInfos.filter(
    (m) => !movedHandles.has(m.handle) && distance(0, 0, m.x - c.x, m.y - c.y) > STRAY_DIST,
  );
  if (strays.length > 0) {
    const strayHandles: number[] = [];
    const straySlots: { x: number; y: number }[] = [];
    for (const m of strays) {
      const s = slotByHandle.get(m.handle);
      strayHandles.push(m.handle);
      straySlots.push(
        s !== undefined ? { x: s.destX, y: s.destY } : { x: squad.lastGoal.x, y: squad.lastGoal.y },
      );
    }
    ctx.emit(MoveIntent, {
      units: strayHandles,
      x: squad.lastGoal.x,
      y: squad.lastGoal.y,
      slots: straySlots,
    });
  }
}
