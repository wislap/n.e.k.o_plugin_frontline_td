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
  clearanceTierForRadius,
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

function isReachableAtTier(
  terrain: SquadsDeps['terrain'],
  pathing: SquadsDeps['pathing'],
  cls: number,
  tier: ClearanceTier,
  goalX: number,
  goalY: number,
  memberInfos: readonly FormationMemberInfo[],
  c: { x: number; y: number },
): boolean {
  const gx = clearanceAnchorCell(goalX, tier);
  const gy = clearanceAnchorCell(goalY, tier);
  if (!terrain.inBounds(gx, gy) || !terrain.passable(gx, gy, cls, tier)) {
    return false;
  }
  const ref = pickPassableRef(terrain, memberInfos, cls, tier, c);
  const rx = clearanceAnchorCell(ref.x, tier);
  const ry = clearanceAnchorCell(ref.y, tier);
  return terrain.inBounds(rx, ry) && pathing.reachable(rx, ry, gx, gy, cls, tier);
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
  if (isReachableAtTier(terrain, pathing, cls, preferredTier, goalX, goalY, memberInfos, c)) {
    return true;
  }
  if (preferredTier === CLEARANCE_HEAVY) {
    return isReachableAtTier(
      terrain,
      pathing,
      cls,
      CLEARANCE_STANDARD,
      goalX,
      goalY,
      memberInfos,
      c,
    );
  }
  return false;
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

function acquireReachableProbe(
  terrain: SquadsDeps['terrain'],
  pathing: SquadsDeps['pathing'],
  cls: number,
  tier: ClearanceTier,
  goalX: number,
  goalY: number,
  refX: number,
  refY: number,
): number | null {
  const gx = clearanceAnchorCell(goalX, tier);
  const gy = clearanceAnchorCell(goalY, tier);
  const rx = clearanceAnchorCell(refX, tier);
  const ry = clearanceAnchorCell(refY, tier);
  if (
    !terrain.inBounds(gx, gy) ||
    !terrain.passable(gx, gy, cls, tier) ||
    !terrain.inBounds(rx, ry) ||
    !pathing.reachable(rx, ry, gx, gy, cls, tier)
  ) {
    return null;
  }
  const probe = pathing.acquireGoal(gx, gy, cls, tier);
  if (pathing.directionAt(probe, rx, ry) !== null) {
    return probe;
  }
  pathing.releaseGoal(probe);
  return null;
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
): { goalId: number; tier: ClearanceTier } | null {
  const primary = acquireReachableProbe(
    terrain,
    pathing,
    cls,
    preferredTier,
    goalX,
    goalY,
    refX,
    refY,
  );
  if (primary !== null) {
    return { goalId: primary, tier: preferredTier };
  }
  if (preferredTier === CLEARANCE_HEAVY) {
    const fallback = acquireReachableProbe(
      terrain,
      pathing,
      cls,
      CLEARANCE_STANDARD,
      goalX,
      goalY,
      refX,
      refY,
    );
    if (fallback !== null) {
      return { goalId: fallback, tier: CLEARANCE_STANDARD };
    }
  }
  return null;
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
  const allHeavy = memberInfos.every((m) => m.tier === CLEARANCE_HEAVY);
  const goalTier: ClearanceTier = allHeavy ? CLEARANCE_HEAVY : CLEARANCE_STANDARD;

  if (fullRebuild) {
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
      const layout = computeFormationLayout(memberInfos);
      const dGoal = distance(c.x, c.y, goalX, goalY);
      const hx = dGoal > 1e-6 ? (goalX - c.x) / dGoal : 1;
      const hy = dGoal > 1e-6 ? (goalY - c.y) / dGoal : 0;
      squad.anchor = {
        x: goalX,
        y: goalY,
        hx,
        hy,
        halfWidth: layout.halfWidth,
      };
      const slotsMap = projectFormationSlots(
        deps.terrain,
        deps.pathing,
        probe?.goalId ?? null,
        goalX,
        goalY,
        hx,
        hy,
        memberInfos,
        layout.offsets,
        1,
        1,
      );
      const nextSlots: SquadSlot[] = [];
      const emitUnits: number[] = [];
      const emitSlots: { x: number; y: number }[] = [];
      for (const m of memberInfos) {
        const off = layout.offsets.get(m.handle) ?? { fwd: 0, right: 0 };
        const dest = slotsMap.get(m.handle) ?? { x: goalX, y: goalY };
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
      ctx.emit(MoveIntent, { units: emitUnits, x: goalX, y: goalY, slots: emitSlots });
    } finally {
      if (probe !== null) {
        deps.pathing.releaseGoal(probe.goalId);
      }
    }
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
  for (const m of settled) {
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
  // Reserve idle-far members' existing slots too before assigning new
  // slots for missing reinforcements so reinforcements don't steal them.
  for (const m of idleFar) {
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

  if (missing.length > 0) {
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
      const layout = computeFormationLayout(memberInfos);
      const dGoal = distance(c.x, c.y, goalX, goalY);
      const hx = squad.anchor?.hx ?? (dGoal > 1e-6 ? (goalX - c.x) / dGoal : 1);
      const hy = squad.anchor?.hy ?? (dGoal > 1e-6 ? (goalY - c.y) / dGoal : 0);
      const assigned = projectFormationSlots(
        deps.terrain,
        deps.pathing,
        probe?.goalId ?? null,
        goalX,
        goalY,
        hx,
        hy,
        missing,
        layout.offsets,
        1,
        1,
        reservedCells,
      );
      for (const m of missing) {
        const off = layout.offsets.get(m.handle) ?? { fwd: 0, right: 0 };
        const dest = assigned.get(m.handle) ?? { x: goalX, y: goalY };
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
      if (squad.anchor !== undefined) {
        squad.anchor.halfWidth = layout.halfWidth;
      }
    } finally {
      if (probe !== null) {
        deps.pathing.releaseGoal(probe.goalId);
      }
    }
  }

  if (subsetHandles.length > 0) {
    ctx.emit(MoveIntent, { units: subsetHandles, x: goalX, y: goalY, slots: subsetSlots });
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
  const preferredTier: ClearanceTier = memberInfos.some((m) => m.tier === CLEARANCE_HEAVY)
    ? CLEARANCE_HEAVY
    : CLEARANCE_STANDARD;
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

  try {
    const fwdByHandle = new Map<number, number>();
    for (const s of squad.slots) {
      fwdByHandle.set(s.handle, s.fwd);
    }
    const distByHandle = new Map<number, number | null>();
    const samples: GeodesicSample[] = [];
    for (const m of memberInfos) {
      const d = deps.pathing.distanceAt(probe.goalId, m.x, m.y);
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
    if (pacing.sRef > 1.0 || pacing.vMax > pacing.vCruise * 1.02) {
      const units: number[] = [];
      const maxSpeeds: number[] = [];
      for (const m of memberInfos) {
        const cap = computeGeodesicCruiseCap(
          m.speed,
          distByHandle.get(m.handle) ?? null,
          fwdByHandle.get(m.handle) ?? 0,
          pacing,
          STRAY_DIST,
        );
        units.push(m.handle);
        maxSpeeds.push(cap);
      }
      ctx.emit(FormationGuideIntent, { units, maxSpeeds, active: true });
      squad.guideActive = true;
    } else {
      releaseGuideIfActive(ctx, squad);
    }
  } finally {
    deps.pathing.releaseGoal(probe.goalId);
  }
}
