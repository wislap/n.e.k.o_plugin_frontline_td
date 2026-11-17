// Per-squad orders update (called on the squad's stagger slot):
// resupply, gather launch, engage split, advance arrival and
// blocked-route retargeting, guard return, and stray recovery.
import { distance } from '../../../core/index';
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import { CARGO_SLOTS, CargoStore, sget } from '../../logistics/sim/index';
import { MoveIntent, StopIntent } from '../../movement/protocol';
import { Mover, MoveTarget, Position } from '../../movement/sim/index';
import { SquadsLaunched } from '../protocol';
import type { SquadsDeps } from './deps';
import { nearestCovered, retargetStructure } from './routing';
import type { Squad, SquadsEnv } from './state';

const ENGAGE_RADIUS = 8;
const ARRIVE_DIST = 2;
const REGOAL_DRIFT = 2;
const LEASH_EXTRA = 4;
const STRAY_DIST = 10;
const RESUPPLY_LEAVE_BP = 3000;
const RESUPPLY_RETURN_BP = 8000;
const RETARGET_PERIOD = 40;

// Mean energy bp over members that have a battery (an energy slot with
// capacity > 0); null when no member carries one.
function meanEnergyBp(
  ctx: SystemContext,
  ids: readonly number[],
  energyCargo: number,
): number | null {
  const store = ctx.read(CargoStore);
  let sum = 0;
  let count = 0;
  for (const id of ids) {
    let amt = 0;
    let cap = 0;
    for (let i = 0; i < CARGO_SLOTS; i++) {
      if (sget(store, 'cargo', i, id) === energyCargo && sget(store, 'cap', i, id) > 0) {
        amt += sget(store, 'amt', i, id);
        cap += sget(store, 'cap', i, id);
      }
    }
    if (cap > 0) {
      sum += Math.floor((amt * 10000) / cap);
      count += 1;
    }
  }
  return count === 0 ? null : Math.floor(sum / count);
}

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

// Move-intent dedupe: emitting a move reassigns slots, so a branch
// emits only when its point differs from the squad's last goal, or a
// member is idle (MoveTarget inactive — e.g. gave up on an unreachable
// goal) and still farther than ARRIVE_DIST from it.
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

function emitMove(
  ctx: SystemContext,
  squad: Squad,
  ids: readonly number[],
  x: number,
  y: number,
): void {
  if (x === squad.lastGoal.x && y === squad.lastGoal.y && !needsMove(ctx, ids, x, y)) {
    return;
  }
  ctx.emit(MoveIntent, { units: [...squad.members], x, y });
  squad.lastGoal = { x, y };
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

  // Resupply: squads with batteries retreat to the nearest own
  // covered cell while their mean energy is below the threshold.
  const bp = meanEnergyBp(ctx, ids, deps.energyCargo);
  if (bp !== null && squad.phase === 'resupplying' && bp >= RESUPPLY_RETURN_BP) {
    squad.phase = 'returning';
  } else if (bp !== null && bp < RESUPPLY_LEAVE_BP && squad.phase !== 'resupplying') {
    squad.phase = 'resupplying';
  }
  if (squad.phase === 'resupplying') {
    // Re-evaluated every update: coverage can appear later, and
    // the nearest covered cell shifts as the squad moves.
    const cell = nearestCovered(ctx, deps, squad.faction as FactionId, c.x, c.y);
    if (cell !== null) {
      emitMove(ctx, squad, ids, cell.x, cell.y);
    }
    return;
  }

  // Gather: sit at the gather point; at launchTick the order
  // becomes advance to the stored target (route already stored).
  const order = squad.order;
  if (order.kind === 'gather') {
    if (ctx.tick >= (order.launchTick ?? 0)) {
      squad.order = {
        kind: 'advance',
        x: order.targetX ?? order.x,
        y: order.targetY ?? order.y,
        radius: 0,
      };
      squad.phase = 'moving';
      ctx.emit(SquadsLaunched, {
        squad: squad.id,
        faction: squad.faction,
        x: squad.order.x,
        y: squad.order.y,
      });
    } else {
      if (squad.phase !== 'holding') {
        squad.phase = 'moving';
      }
      if (distance(0, 0, order.x - c.x, order.y - c.y) > ARRIVE_DIST) {
        emitMove(ctx, squad, ids, order.x, order.y);
      } else {
        squad.phase = 'holding';
      }
      return;
    }
  }

  const goalX = order.x;
  const goalY = order.y;
  const engageRadius = order.kind === 'guard' ? order.radius : ENGAGE_RADIUS;
  const ax = order.kind === 'guard' ? order.x : c.x;
  const ay = order.kind === 'guard' ? order.y : c.y;
  // Guard retention: keep chasing the engaged target while it
  // stays inside the leash (radius + LEASH_EXTRA); new targets
  // are acquired only inside the guard radius.
  let hostile: EntityId | null = null;
  if (order.kind === 'guard' && squad.engage !== undefined) {
    const id = ctx.resolve(squad.engage as EntityHandle);
    const fac = ctx.read(Faction);
    if (
      id !== null &&
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
    const hx = pos.x[hostile] ?? 0;
    const hy = pos.y[hostile] ?? 0;
    squad.phase = 'engaging';
    // Engage split: members in weapon range stop, the rest move.
    const stop: number[] = [];
    const move: number[] = [];
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
        units: needStop.map((id) => Number(ctx.handleOf(id as EntityId))),
      });
    }
    if (
      move.length > 0 &&
      (distance(0, 0, hx - squad.lastGoal.x, hy - squad.lastGoal.y) >= REGOAL_DRIFT ||
        needsMove(ctx, move, hx, hy))
    ) {
      ctx.emit(MoveIntent, {
        units: move.map((id) => Number(ctx.handleOf(id as EntityId))),
        x: hx,
        y: hy,
      });
      squad.lastGoal = { x: hx, y: hy };
    }
    return;
  }

  // No hostile: advance arrives → guard; guard returns to point.
  if (order.kind === 'advance') {
    if (distance(0, 0, order.x - c.x, order.y - c.y) <= ARRIVE_DIST) {
      squad.order = { kind: 'guard', x: order.x, y: order.y, radius: 6 };
      squad.phase = 'holding';
      return;
    }
    // Re-check the original goal's reachability on every update — it is
    // cheap while members hold that goal's flow field, and a route
    // walled off mid-advance must be caught even without goal drift.
    const cls = mover.cls[ids[0] ?? 0] ?? 0;
    const probe = deps.pathing.acquireGoal(goalX, goalY, cls);
    const reachable = deps.pathing.directionAt(probe, Math.floor(c.x), Math.floor(c.y)) !== null;
    deps.pathing.releaseGoal(probe);
    if (reachable) {
      // Route open (again): head for the real target — emitMove no-ops
      // when the squad already holds it.
      emitMove(ctx, squad, ids, goalX, goalY);
      squad.phase = 'moving';
      delete squad.retarget;
    } else if (squad.retarget === undefined || ctx.tick - squad.retarget >= RETARGET_PERIOD) {
      // Blocked route: retarget to the nearest reachable hostile
      // structure, at most once per RETARGET_PERIOD. The squad keeps
      // marching on lastGoal between retargets.
      squad.retarget = ctx.tick;
      const next = retargetStructure(ctx, deps, squad.faction as FactionId, cls, c.x, c.y);
      if (next === null) {
        squad.phase = 'holding';
      } else {
        emitMove(ctx, squad, ids, next.x, next.y);
        squad.phase = 'moving';
      }
    }
  } else if (order.kind === 'guard') {
    const far = ids.some(
      (id) => distance(0, 0, (pos.x[id] ?? 0) - order.x, (pos.y[id] ?? 0) - order.y) > order.radius,
    );
    if (far || squad.phase === 'returning' || squad.phase === 'engaging') {
      if (distance(0, 0, order.x - c.x, order.y - c.y) > ARRIVE_DIST) {
        emitMove(ctx, squad, ids, order.x, order.y);
        squad.phase = 'moving';
      } else {
        squad.phase = 'holding';
      }
    } else {
      squad.phase = 'holding';
    }
  }

  // Strays (>10 cells from the centroid, e.g. reinforcements) get
  // a move to the squad's current goal.
  const strays = ids.filter(
    (id) => distance(0, 0, (pos.x[id] ?? 0) - c.x, (pos.y[id] ?? 0) - c.y) > STRAY_DIST,
  );
  if (strays.length > 0) {
    ctx.emit(MoveIntent, {
      units: strays.map((id) => Number(ctx.handleOf(id))),
      x: squad.lastGoal.x,
      y: squad.lastGoal.y,
    });
  }
}
