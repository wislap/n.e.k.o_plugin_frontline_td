// Squad transit guidance: member info snapshot collection, O(1) component
// reachability checks with Heavy->Standard fallback, persistent slot
// assignment/subset preservation, and 1D Eikonal geodesic trimmed-median
// cruise speed pacing (ADR 0054 / ADR 0057).
import { distance } from '../../../core/index';
import type { EntityId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { FormationGuideIntent, MoveIntent } from '../../movement/protocol';
import { MoveSpeed, Mover, MoveTarget, Position } from '../../movement/sim/index';
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
  computeFormationLayout,
  computeGeodesicCruiseCap,
  computeGeodesicPacing,
  markFootprintCells,
  projectFormationSlots,
  type FormationMemberInfo,
  type GeodesicSample,
} from './formation';
import type { Squad, SquadSlot } from './state';

export const SQUAD_PERIOD = 10;
export const ARRIVE_DIST = 2;
export const STRAY_DIST = 10;

const GUIDE_RELEASE_DIST = 7;
const SQUAD_GOAL_SNAP_RING = 6;

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
    const score = (dx * dx + dy * dy) * 1024 + faceDistSq;
    if (score < bestScore) {
      bestScore = score;
      bestX = cx;
      bestY = cy;
    }
  }
  return bestX >= 0 ? { gx: bestX, gy: bestY } : null;
}

function pickPassableRef(
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

function resolveGoalCellWithFallback(
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

function projectSquadMembersWithProbe(
  deps: SquadsDeps,
  memberInfos: readonly FormationMemberInfo[],
  targetsToProject: readonly FormationMemberInfo[],
  c: { x: number; y: number },
  goalX: number,
  goalY: number,
  cls: number,
  goalTier: ClearanceTier,
  preferredHeading?: { hx: number; hy: number },
  reservedCells?: ReadonlySet<number>,
): {
  effX: number;
  effY: number;
  emitGx: number;
  emitGy: number;
  hx: number;
  hy: number;
  offsets: Map<number, { fwd: number; right: number }>;
  projected: Map<number, { x: number; y: number }>;
} {
  const singleClass = memberInfos.every((m) => m.cls === cls);
  const ref = singleClass ? pickPassableRef(deps.terrain, memberInfos, cls, goalTier, c) : c;
  const probe = singleClass
    ? acquireProbeWithFallback(
        deps.terrain,
        deps.pathing,
        cls,
        goalTier,
        goalX,
        goalY,
        ref.x,
        ref.y,
      )
    : null;
  try {
    const effX = probe !== null ? clearanceAnchorCenter(probe.gx, probe.tier) : goalX;
    const effY = probe !== null ? clearanceAnchorCenter(probe.gy, probe.tier) : goalY;
    const emitGx = probe !== null ? probe.gx : Math.floor(goalX);
    const emitGy = probe !== null ? probe.gy : Math.floor(goalY);
    const layout = computeFormationLayout(memberInfos);
    const dGoal = distance(c.x, c.y, effX, effY);
    const hx = preferredHeading?.hx ?? (dGoal > 1e-6 ? (effX - c.x) / dGoal : 1);
    const hy = preferredHeading?.hy ?? (dGoal > 1e-6 ? (effY - c.y) / dGoal : 0);
    const projected = projectFormationSlots(
      deps.terrain,
      deps.pathing,
      probe?.goalId ?? null,
      effX,
      effY,
      hx,
      hy,
      targetsToProject,
      layout.offsets,
      reservedCells,
    );
    return {
      effX,
      effY,
      emitGx,
      emitGy,
      hx,
      hy,
      offsets: layout.offsets,
      projected,
    };
  } finally {
    if (probe !== null) {
      deps.pathing.releaseGoal(probe.goalId);
    }
  }
}

// Persistent formation assignment + MoveIntent dedupe (ADR 0054).
// Returns the set of handles that received a MoveIntent on this tick.
export function ensureSquadSlotsAndEmitMove(
  ctx: SystemContext,
  deps: SquadsDeps,
  squad: Squad,
  memberInfos: readonly FormationMemberInfo[],
  c: { x: number; y: number },
  goalX: number,
  goalY: number,
  forceAll = false,
): Set<number> {
  const emitted = new Set<number>();
  if (memberInfos.length === 0) {
    return emitted;
  }

  const goalChanged = goalX !== squad.lastGoal.x || goalY !== squad.lastGoal.y;
  const prevSlotCount = squad.slots?.length ?? 0;
  const significantAttrition =
    squad.slots !== undefined &&
    prevSlotCount > 0 &&
    (prevSlotCount - memberInfos.length) * 10 >= prevSlotCount * 3;
  const fullRebuild = forceAll || goalChanged || squad.slots === undefined || significantAttrition;

  const first = memberInfos[0];
  const cls = first?.cls ?? 0;
  const singleClass = memberInfos.every((m) => m.cls === cls);
  const goalTier = squadGoalTier(memberInfos);

  if (fullRebuild) {
    const res = projectSquadMembersWithProbe(
      deps,
      memberInfos,
      memberInfos,
      c,
      goalX,
      goalY,
      cls,
      goalTier,
    );
    squad.heading = { hx: res.hx, hy: res.hy };
    const nextSlots: SquadSlot[] = [];
    const emitUnits: number[] = [];
    const emitSlots: { x: number; y: number }[] = [];
    for (const m of memberInfos) {
      const off = res.offsets.get(m.handle) ?? { fwd: 0, right: 0 };
      const dest = res.projected.get(m.handle) ?? { x: res.effX, y: res.effY };
      nextSlots.push({
        handle: m.handle,
        fwd: off.fwd,
        right: off.right,
        destX: dest.x,
        destY: dest.y,
      });
      emitUnits.push(m.handle);
      emitSlots.push({ x: dest.x, y: dest.y });
      emitted.add(m.handle);
    }
    squad.slots = nextSlots;
    squad.lastGoal = { x: goalX, y: goalY };
    ctx.emit(MoveIntent, {
      units: emitUnits,
      x: res.emitGx,
      y: res.emitGy,
      slots: emitSlots,
    });
    return emitted;
  }

  // Same destination: check for missing members (e.g. reinforcements) or
  // idle-far members (stopped early while still outside ARRIVE_DIST).
  const slotByHandle = new Map<number, SquadSlot>();
  for (const s of squad.slots ?? []) {
    slotByHandle.set(s.handle, s);
  }
  const tgt = ctx.read(MoveTarget);
  const missing: FormationMemberInfo[] = [];
  const idleFar: FormationMemberInfo[] = [];
  const settled: FormationMemberInfo[] = [];
  for (const m of memberInfos) {
    const s = slotByHandle.get(m.handle);
    if (s === undefined) {
      missing.push(m);
    } else if (
      (tgt.active[m.id] ?? 0) === 0 &&
      distance(m.x, m.y, s.destX, s.destY) > ARRIVE_DIST
    ) {
      idleFar.push(m);
    } else {
      settled.push(m);
    }
  }

  if (missing.length === 0 && idleFar.length === 0) {
    return emitted;
  }

  const reservedCells = new Set<number>();
  for (const list of [settled, idleFar]) {
    for (const m of list) {
      const s = slotByHandle.get(m.handle);
      if (s !== undefined) {
        markFootprintCells(
          reservedCells,
          deps.terrain.width,
          deps.terrain.height,
          s.destX,
          s.destY,
          m.tier,
        );
      }
    }
  }

  const subsetHandles: number[] = [];
  const subsetSlots: { x: number; y: number }[] = [];

  for (const m of idleFar) {
    const s = slotByHandle.get(m.handle);
    if (s !== undefined) {
      subsetHandles.push(m.handle);
      subsetSlots.push({ x: s.destX, y: s.destY });
      emitted.add(m.handle);
    }
  }

  let emitGx = Math.floor(goalX);
  let emitGy = Math.floor(goalY);
  if (missing.length > 0) {
    const res = projectSquadMembersWithProbe(
      deps,
      memberInfos,
      missing,
      c,
      goalX,
      goalY,
      cls,
      goalTier,
      squad.heading,
      reservedCells,
    );
    emitGx = res.emitGx;
    emitGy = res.emitGy;
    for (const m of missing) {
      const off = res.offsets.get(m.handle) ?? { fwd: 0, right: 0 };
      const dest = res.projected.get(m.handle) ?? { x: res.effX, y: res.effY };
      squad.slots?.push({
        handle: m.handle,
        fwd: off.fwd,
        right: off.right,
        destX: dest.x,
        destY: dest.y,
      });
      subsetHandles.push(m.handle);
      subsetSlots.push({ x: dest.x, y: dest.y });
      emitted.add(m.handle);
    }
  } else if (singleClass) {
    const snapped = resolveGoalCellWithFallback(
      deps.terrain,
      deps.pathing,
      cls,
      goalTier,
      goalX,
      goalY,
      memberInfos,
      c,
    );
    if (snapped !== null) {
      emitGx = snapped.gx;
      emitGy = snapped.gy;
    }
  }

  if (subsetHandles.length > 0) {
    ctx.emit(MoveIntent, { units: subsetHandles, x: emitGx, y: emitGy, slots: subsetSlots });
  }
  return emitted;
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
      (pacing.sRef <= GUIDE_RELEASE_DIST && pacing.vMax <= pacing.vCruise * 1.02)
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
