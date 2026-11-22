// Squad transit guidance: member info snapshot collection, O(1) component
// reachability checks with Heavy->Standard fallback, persistent slot
// assignment/subset preservation, and 1D Eikonal geodesic trimmed-median
// cruise speed pacing (ADR 0054 / ADR 0057).
import type { EntityId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { FormationGuideIntent } from '../../movement/protocol';
import { MoveSpeed, Mover, Position } from '../../movement/sim/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  clearanceTierForRadius,
  spiralOffsets,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { SquadsDeps } from './deps';
import {
  computeGeodesicCruiseCap,
  computeGeodesicPacing,
  type FormationMemberInfo,
  type GeodesicSample,
} from './formation';
import type { Squad } from './state';

export const SQUAD_PERIOD = 10;
export const ARRIVE_DIST = 2;
export const STRAY_DIST = 10;

const GUIDE_RELEASE_DIST = 7;
const SQUAD_GOAL_SNAP_RING = 6;
// Slot score: squared snap-ring distance dominates, anchor-facing distance
// breaks ties (scaled up so any ring step outweighs facing).
const SLOT_SCORE_CELL_WEIGHT = 1024;
// Formation guide is released when the cruise cap lands within this
// tolerance of the geodesic reference speed.
const GUIDE_RELEASE_CRUISE_TOLERANCE = 1.02;

function resolveSquadGoalAtTier(
  terrain: SquadsDeps['terrain'],
  pathing: SquadsDeps['pathing'],
  cls: number,
  tier: ClearanceTier,
  goalX: number,
  goalY: number,
  refX: number,
  refY: number,
): { gx: number; gy: number } | null {
  const rx = clearanceAnchorCell(refX, tier);
  const ry = clearanceAnchorCell(refY, tier);
  if (!terrain.inBounds(rx, ry)) {
    return null;
  }
  const rawGx = clearanceAnchorCell(goalX, tier);
  const rawGy = clearanceAnchorCell(goalY, tier);
  if (!terrain.inBounds(rawGx, rawGy)) {
    return null;
  }
  if (terrain.passable(rawGx, rawGy, cls, tier)) {
    return pathing.reachable(rx, ry, rawGx, rawGy, cls, tier) ? { gx: rawGx, gy: rawGy } : null;
  }
  let bestScore = Infinity;
  let bestX = -1;
  let bestY = -1;
  for (const [dx, dy] of spiralOffsets(rawGx, rawGy, terrain.width, terrain.height)) {
    const ring = Math.max(Math.abs(dx), Math.abs(dy));
    if (ring > SQUAD_GOAL_SNAP_RING) {
      break;
    }
    const cx = rawGx + dx;
    const cy = rawGy + dy;
    if (!terrain.passable(cx, cy, cls, tier) || !pathing.reachable(rx, ry, cx, cy, cls, tier)) {
      continue;
    }
    const ccx = clearanceAnchorCenter(cx, tier);
    const ccy = clearanceAnchorCenter(cy, tier);
    const faceDistSq = (ccx - refX) * (ccx - refX) + (ccy - refY) * (ccy - refY);
    const score = (dx * dx + dy * dy) * SLOT_SCORE_CELL_WEIGHT + faceDistSq;
    if (score < bestScore) {
      bestScore = score;
      bestX = cx;
      bestY = cy;
    }
  }
  return bestX >= 0 ? { gx: bestX, gy: bestY } : null;
}

export function pickPassableRef(
  terrain: SquadsDeps['terrain'],
  memberInfos: readonly FormationMemberInfo[],
  cls: number,
  tier: ClearanceTier,
  c: { x: number; y: number },
): { x: number; y: number } {
  const cx = clearanceAnchorCell(c.x, tier);
  const cy = clearanceAnchorCell(c.y, tier);
  if (terrain.inBounds(cx, cy) && terrain.passable(cx, cy, cls, tier)) {
    return c;
  }
  for (const m of memberInfos) {
    const mx = clearanceAnchorCell(m.x, tier);
    const my = clearanceAnchorCell(m.y, tier);
    if (terrain.inBounds(mx, my) && terrain.passable(mx, my, cls, tier)) {
      return { x: m.x, y: m.y };
    }
  }
  return c;
}

export function squadGoalTier(members: readonly FormationMemberInfo[]): ClearanceTier {
  return members.some((m) => m.tier === CLEARANCE_HEAVY) ? CLEARANCE_HEAVY : CLEARANCE_STANDARD;
}

export function resolveGoalCellWithFallback(
  terrain: SquadsDeps['terrain'],
  pathing: SquadsDeps['pathing'],
  cls: number,
  preferredTier: ClearanceTier,
  goalX: number,
  goalY: number,
  memberInfos: readonly FormationMemberInfo[],
  c: { x: number; y: number },
): { gx: number; gy: number; tier: ClearanceTier } | null {
  const attempts = preferredTier === CLEARANCE_HEAVY ? 2 : 1;
  for (let i = 0; i < attempts; i++) {
    const tier = i === 0 ? preferredTier : CLEARANCE_STANDARD;
    const ref = pickPassableRef(terrain, memberInfos, cls, tier, c);
    const hit = resolveSquadGoalAtTier(terrain, pathing, cls, tier, goalX, goalY, ref.x, ref.y);
    if (hit !== null) {
      return { gx: hit.gx, gy: hit.gy, tier };
    }
  }
  return null;
}

export function isGoalReachableWithFallback(
  terrain: SquadsDeps['terrain'],
  pathing: SquadsDeps['pathing'],
  cls: number,
  preferredTier: ClearanceTier,
  goalX: number,
  goalY: number,
  memberInfos: readonly FormationMemberInfo[],
  c: { x: number; y: number },
): boolean {
  return (
    resolveGoalCellWithFallback(
      terrain,
      pathing,
      cls,
      preferredTier,
      goalX,
      goalY,
      memberInfos,
      c,
    ) !== null
  );
}

export function collectMemberInfos(
  ctx: SystemContext,
  deps: SquadsDeps,
  ids: readonly EntityId[],
): FormationMemberInfo[] {
  const pos = ctx.read(Position);
  const mover = ctx.read(Mover);
  const out: FormationMemberInfo[] = [];
  for (const id of ids) {
    const h = ctx.handleOf(id);
    if (h === null) {
      continue;
    }
    const radius = mover.radius[id] ?? 0;
    const baseSpeed = mover.speed[id] ?? 0;
    out.push({
      handle: Number(h),
      id,
      x: pos.x[id] ?? 0,
      y: pos.y[id] ?? 0,
      radius,
      speed: ctx.stat(MoveSpeed, id, baseSpeed),
      cls: mover.cls[id] ?? 0,
      tier: clearanceTierForRadius(radius),
      range: deps.combat.weaponRange(ctx, id),
    });
  }
  return out;
}

export function releaseGuideIfActive(ctx: SystemContext, squad: Squad): void {
  if (squad.guideActive === true) {
    if (squad.members.length > 0) {
      ctx.emit(FormationGuideIntent, {
        units: [...squad.members],
        active: false,
      });
    }
    delete squad.guideActive;
  }
}

export function acquireProbeWithFallback(
  terrain: SquadsDeps['terrain'],
  pathing: SquadsDeps['pathing'],
  cls: number,
  preferredTier: ClearanceTier,
  goalX: number,
  goalY: number,
  refX: number,
  refY: number,
): { goalId: number; tier: ClearanceTier; gx: number; gy: number } | null {
  const attempts = preferredTier === CLEARANCE_HEAVY ? 2 : 1;
  for (let i = 0; i < attempts; i++) {
    const tier = i === 0 ? preferredTier : CLEARANCE_STANDARD;
    const resolved = resolveSquadGoalAtTier(terrain, pathing, cls, tier, goalX, goalY, refX, refY);
    if (resolved === null) {
      continue;
    }
    const probe = pathing.acquireGoal(resolved.gx, resolved.gy, cls, tier);
    const rx = clearanceAnchorCell(refX, tier);
    const ry = clearanceAnchorCell(refY, tier);
    if (pathing.directionAt(probe, rx, ry) !== null) {
      return { goalId: probe, tier, gx: resolved.gx, gy: resolved.gy };
    }
    pathing.releaseGoal(probe);
  }
  return null;
}

export function emitTransitGuide(
  ctx: SystemContext,
  deps: SquadsDeps,
  squad: Squad,
  memberInfos: readonly FormationMemberInfo[],
  c: { x: number; y: number },
  goalX: number,
  goalY: number,
): void {
  if (
    (squad.phase !== 'moving' && squad.phase !== 'returning') ||
    memberInfos.length < 2 ||
    squad.slots === undefined
  ) {
    return;
  }

  const cls = memberInfos[0]?.cls ?? 0;
  const preferredTier = squadGoalTier(memberInfos);
  const ref = pickPassableRef(deps.terrain, memberInfos, cls, preferredTier, c);
  const probe = acquireProbeWithFallback(
    deps.terrain,
    deps.pathing,
    cls,
    preferredTier,
    goalX,
    goalY,
    ref.x,
    ref.y,
  );
  if (probe === null) {
    releaseGuideIfActive(ctx, squad);
    return;
  }

  let stdFallbackGoalId: number | null = null;
  try {
    const fwdByHandle = new Map<number, number>();
    for (const s of squad.slots) {
      fwdByHandle.set(s.handle, s.fwd);
    }
    const distByHandle = new Map<number, number | null>();
    const samples: GeodesicSample[] = [];
    for (const m of memberInfos) {
      let d = deps.pathing.distanceAt(probe.goalId, m.x, m.y);
      if (d === null && probe.tier === CLEARANCE_HEAVY && m.tier === CLEARANCE_STANDARD) {
        stdFallbackGoalId ??= deps.pathing.acquireGoal(probe.gx, probe.gy, cls, CLEARANCE_STANDARD);
        d = deps.pathing.distanceAt(stdFallbackGoalId, m.x, m.y);
      }
      distByHandle.set(m.handle, d);
      if (d !== null) {
        samples.push({
          handle: m.handle,
          dist: d,
          fwd: fwdByHandle.get(m.handle) ?? 0,
          speed: m.speed,
        });
      }
    }
    const pacing = computeGeodesicPacing(samples, STRAY_DIST);
    if (
      pacing === null ||
      (pacing.sRef <= GUIDE_RELEASE_DIST &&
        pacing.vMax <= pacing.vCruise * GUIDE_RELEASE_CRUISE_TOLERANCE)
    ) {
      releaseGuideIfActive(ctx, squad);
      return;
    }
    const units: number[] = [];
    const maxSpeeds: number[] = [];
    for (const m of memberInfos) {
      units.push(m.handle);
      maxSpeeds.push(
        computeGeodesicCruiseCap(
          m.speed,
          distByHandle.get(m.handle) ?? null,
          fwdByHandle.get(m.handle) ?? 0,
          pacing,
          STRAY_DIST,
        ),
      );
    }
    ctx.emit(FormationGuideIntent, { units, maxSpeeds, active: true });
    squad.guideActive = true;
  } finally {
    if (stdFallbackGoalId !== null) {
      deps.pathing.releaseGoal(stdFallbackGoalId);
    }
    deps.pathing.releaseGoal(probe.goalId);
  }
}
