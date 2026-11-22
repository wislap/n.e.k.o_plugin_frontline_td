// Squad slot assignment and MoveIntent emission (ADR 0054): full rebuild
// projection, same-destination member classification, reinforcement
// subset projection, and intent dedupe. Split from transit.ts.
import { distance } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { MoveIntent } from '../../movement/protocol';
import { MoveTarget } from '../../movement/sim/index';
import { clearanceAnchorCenter, type ClearanceTier } from '../../terrain/rules/index';
import type { SquadsDeps } from './deps';
import {
  computeFormationLayout,
  markFootprintCells,
  projectFormationSlots,
  type FormationMemberInfo,
} from './formation';
import type { Squad, SquadSlot } from './state';
import {
  acquireProbeWithFallback,
  ARRIVE_DIST,
  pickPassableRef,
  resolveGoalCellWithFallback,
  squadGoalTier,
} from './transit';

// Rebuild the persistent slot layout when this fraction of slots is lost
// to attrition (numerator/denominator = 30%).
const ATTRITION_NUMERATOR = 3;
const ATTRITION_DENOMINATOR = 10;

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

// Full rebuild: project every member, replace squad.slots and heading,
// then emit one MoveIntent covering the whole squad.
function rebuildSquadSlots(
  ctx: SystemContext,
  deps: SquadsDeps,
  squad: Squad,
  memberInfos: readonly FormationMemberInfo[],
  c: { x: number; y: number },
  goalX: number,
  goalY: number,
  cls: number,
  goalTier: ClearanceTier,
  emitted: Set<number>,
): void {
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
}

// Same-destination pass: bucket members as missing (no slot), idle-far
// (stopped early outside ARRIVE_DIST) or settled, indexed by squad.slots.
function classifySquadMembers(
  ctx: SystemContext,
  squad: Squad,
  memberInfos: readonly FormationMemberInfo[],
): {
  slotByHandle: Map<number, SquadSlot>;
  missing: FormationMemberInfo[];
  idleFar: FormationMemberInfo[];
  settled: FormationMemberInfo[];
} {
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
  return { slotByHandle, missing, idleFar, settled };
}

// Reserve the destination cells of members that keep their current slot so
// reinforcements cannot be projected onto occupied ground.
function reserveSettledCells(
  deps: SquadsDeps,
  slotByHandle: Map<number, SquadSlot>,
  settled: readonly FormationMemberInfo[],
  idleFar: readonly FormationMemberInfo[],
): Set<number> {
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
  return reservedCells;
}

// Re-emit idle-far members at their existing slot destinations.
function collectIdleFarSubset(
  slotByHandle: Map<number, SquadSlot>,
  idleFar: readonly FormationMemberInfo[],
  subsetHandles: number[],
  subsetSlots: { x: number; y: number }[],
  emitted: Set<number>,
): void {
  for (const m of idleFar) {
    const s = slotByHandle.get(m.handle);
    if (s !== undefined) {
      subsetHandles.push(m.handle);
      subsetSlots.push({ x: s.destX, y: s.destY });
      emitted.add(m.handle);
    }
  }
}

// Project missing members (e.g. reinforcements) into new slots, append them
// to squad.slots, and return the resolved emit goal.
function projectMissingMembers(
  ctx: SystemContext,
  deps: SquadsDeps,
  squad: Squad,
  memberInfos: readonly FormationMemberInfo[],
  missing: readonly FormationMemberInfo[],
  c: { x: number; y: number },
  goalX: number,
  goalY: number,
  cls: number,
  goalTier: ClearanceTier,
  reservedCells: ReadonlySet<number>,
  subsetHandles: number[],
  subsetSlots: { x: number; y: number }[],
  emitted: Set<number>,
): { emitGx: number; emitGy: number } {
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
  return { emitGx: res.emitGx, emitGy: res.emitGy };
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
    (prevSlotCount - memberInfos.length) * ATTRITION_DENOMINATOR >=
      prevSlotCount * ATTRITION_NUMERATOR;
  const fullRebuild = forceAll || goalChanged || squad.slots === undefined || significantAttrition;

  const first = memberInfos[0];
  const cls = first?.cls ?? 0;
  const singleClass = memberInfos.every((m) => m.cls === cls);
  const goalTier = squadGoalTier(memberInfos);

  if (fullRebuild) {
    rebuildSquadSlots(ctx, deps, squad, memberInfos, c, goalX, goalY, cls, goalTier, emitted);
    return emitted;
  }

  const { slotByHandle, missing, idleFar, settled } = classifySquadMembers(ctx, squad, memberInfos);

  if (missing.length === 0 && idleFar.length === 0) {
    return emitted;
  }

  const reservedCells = reserveSettledCells(deps, slotByHandle, settled, idleFar);

  const subsetHandles: number[] = [];
  const subsetSlots: { x: number; y: number }[] = [];

  collectIdleFarSubset(slotByHandle, idleFar, subsetHandles, subsetSlots, emitted);

  let emitGx = Math.floor(goalX);
  let emitGy = Math.floor(goalY);
  if (missing.length > 0) {
    const emit = projectMissingMembers(
      ctx,
      deps,
      squad,
      memberInfos,
      missing,
      c,
      goalX,
      goalY,
      cls,
      goalTier,
      reservedCells,
      subsetHandles,
      subsetSlots,
      emitted,
    );
    emitGx = emit.emitGx;
    emitGy = emit.emitGy;
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
