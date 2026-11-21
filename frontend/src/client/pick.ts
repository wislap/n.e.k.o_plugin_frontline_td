// Entity and subject picking from snapshot channels (ADR 0048):
// `pickSubjectAt` resolves any hover/click target (own/hostile unit,
// ruin, own/hostile structure, road segment, salvage, fog memory, or
// terrain cell); `pickDemolishableAt` resolves cancellable own structures
// or road segments; `pickAt` remains for own-entity compatibility.
import type { Snapshot } from '../core/index';
import type { ContentDb } from '../content/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../features/construction/protocol';
import { classifyCancelSelection } from '../features/construction/rules/index';
import { VisionMemoryChannel, type VisionMemory } from '../features/vision/protocol';
import type { HoverSubject } from './inspector-store';

export interface PickResult {
  ownHandle: number | null;
  subject: HoverSubject | null;
}

export interface DemolishPick {
  handle: number;
  refunds: { cargo: number; milli: number }[];
}

export function structuresChannel(snapshot: Snapshot | null): ConstructionStructures | null {
  return (snapshot?.channels[StructuresChannel.id] as ConstructionStructures | undefined) ?? null;
}

function salvageChannel(snapshot: Snapshot | null): ConstructionSalvage | null {
  return (snapshot?.channels[SalvageChannel.id] as ConstructionSalvage | undefined) ?? null;
}

function roadWorksChannel(snapshot: Snapshot | null): RoadWorks | null {
  return (snapshot?.channels[RoadWorksChannel.id] as RoadWorks | undefined) ?? null;
}

function visionMemoryChannel(snapshot: Snapshot | null): VisionMemory | null {
  return (snapshot?.channels[VisionMemoryChannel.id] as VisionMemory | undefined) ?? null;
}

function findOwnStructureAt(
  db: ContentDb,
  structures: ConstructionStructures | null,
  observer: number,
  x: number,
  y: number,
): number | null {
  if (structures === null) {
    return null;
  }
  for (let i = 0; i < structures.handles.length; i++) {
    if ((structures.faction[i] ?? 0) !== observer) {
      continue;
    }
    const kind = db.structures.byIndex(structures.kind[i] ?? 0);
    const sx = structures.x[i] ?? 0;
    const sy = structures.y[i] ?? 0;
    if (
      kind !== undefined &&
      x >= sx &&
      x < sx + kind.footprint.w &&
      y >= sy &&
      y < sy + kind.footprint.h
    ) {
      return structures.handles[i] ?? null;
    }
  }
  return null;
}

function findNearestRoadSegment(
  roadWorks: RoadWorks | null,
  x: number,
  y: number,
  radius: number,
): number | null {
  if (roadWorks === null) {
    return null;
  }
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < roadWorks.segments.handles.length; i++) {
    const d = Math.hypot((roadWorks.segments.x[i] ?? 0) - x, (roadWorks.segments.y[i] ?? 0) - y);
    if (d <= radius && d < bestDist) {
      bestDist = d;
      best = roadWorks.segments.handles[i] ?? null;
    }
  }
  return best;
}

// Click selection (own entities only): nearest own unit inside `radius`
// wins; an own structure/blueprint/salvage/road segment is only picked
// when no unit is near.
export function pickAt(
  db: ContentDb,
  snapshot: Snapshot | null,
  observer: number,
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>,
  x: number,
  y: number,
  radius = 0.6,
): number | null {
  let best: number | null = null;
  let bestDist = radius;
  for (const [handle, u] of units) {
    if (u.faction !== observer) {
      continue;
    }
    const d = Math.hypot(u.x - x, u.y - y);
    if (d <= bestDist) {
      bestDist = d;
      best = handle;
    }
  }
  return best ?? pickStructureAt(db, snapshot, observer, x, y, radius);
}

// Nearest own structure/blueprint whose footprint contains the point
// (ties by row order); falls back to own salvage or road segment within `radius`.
function pickStructureAt(
  db: ContentDb,
  snapshot: Snapshot | null,
  observer: number,
  x: number,
  y: number,
  radius = 0.6,
): number | null {
  const ownStructure = findOwnStructureAt(db, structuresChannel(snapshot), observer, x, y);
  if (ownStructure !== null) {
    return ownStructure;
  }
  // Salvage and road-work segments share one nearest-candidate search:
  // the salvage channel always exists, so early-returning here would
  // make road segments unpickable.
  let best: number | null = null;
  let bestDist = radius;
  const salvage = salvageChannel(snapshot);
  if (salvage !== null) {
    for (let i = 0; i < salvage.handles.length; i++) {
      const d = Math.hypot((salvage.x[i] ?? 0) - x, (salvage.y[i] ?? 0) - y);
      if (d <= bestDist) {
        bestDist = d;
        best = salvage.handles[i] ?? null;
      }
    }
  }
  const roadWorks = roadWorksChannel(snapshot);
  if (roadWorks !== null) {
    for (let i = 0; i < roadWorks.segments.handles.length; i++) {
      const d = Math.hypot((roadWorks.segments.x[i] ?? 0) - x, (roadWorks.segments.y[i] ?? 0) - y);
      if (d <= bestDist) {
        bestDist = d;
        best = roadWorks.segments.handles[i] ?? null;
      }
    }
  }
  return best;
}

// Subject picking across all visible/remembered entities and terrain cells:
// (1) nearest unit within radius (own wins exact distance ties);
// (2) live structure/ruin footprint;
// (3) nearest road segment or salvage within radius (road segment wins ties);
// (4) fog-memory structure footprint;
// (5) terrain cell.
export function pickSubjectAt(
  db: ContentDb,
  mapDims: { width: number; height: number },
  snapshot: Snapshot | null,
  observer: number,
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>,
  x: number,
  y: number,
  radius = 0.6,
): PickResult {
  if (!(x >= 0 && y >= 0 && x < mapDims.width && y < mapDims.height)) {
    return { ownHandle: null, subject: null };
  }

  // (1) Nearest unit within radius; own unit wins on exact distance tie.
  let bestUnit: number | null = null;
  let bestUnitDist = Infinity;
  let bestUnitOwn = false;
  for (const [handle, u] of units) {
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > radius) {
      continue;
    }
    const isOwn = u.faction === observer;
    if (d < bestUnitDist || (d === bestUnitDist && isOwn && !bestUnitOwn)) {
      bestUnitDist = d;
      bestUnit = handle;
      bestUnitOwn = isOwn;
    }
  }
  if (bestUnit !== null) {
    return bestUnitOwn
      ? { ownHandle: bestUnit, subject: { kind: 'own_unit', handle: bestUnit } }
      : { ownHandle: null, subject: { kind: 'hostile_unit', handle: bestUnit } };
  }

  // (2) StructuresChannel footprint containing (x, y).
  const structures = structuresChannel(snapshot);
  if (structures !== null) {
    for (let i = 0; i < structures.handles.length; i++) {
      const kind = db.structures.byIndex(structures.kind[i] ?? 0);
      const sx = structures.x[i] ?? 0;
      const sy = structures.y[i] ?? 0;
      if (
        kind !== undefined &&
        x >= sx &&
        x < sx + kind.footprint.w &&
        y >= sy &&
        y < sy + kind.footprint.h
      ) {
        const handle = structures.handles[i] ?? 0;
        const state = structures.state[i] ?? 0;
        const faction = structures.faction[i] ?? 0;
        if (state === STATE_RUIN) {
          return { ownHandle: null, subject: { kind: 'ruin', handle } };
        }
        if (faction === observer) {
          return { ownHandle: handle, subject: { kind: 'own_structure', handle } };
        }
        return { ownHandle: null, subject: { kind: 'hostile_structure', handle } };
      }
    }
  }

  // (3) Nearest RoadWorks segment or Salvage pile within radius.
  let bestWorkDist = Infinity;
  let bestWork: PickResult | null = null;
  const roadWorks = roadWorksChannel(snapshot);
  if (roadWorks !== null) {
    for (let i = 0; i < roadWorks.segments.handles.length; i++) {
      const d = Math.hypot((roadWorks.segments.x[i] ?? 0) - x, (roadWorks.segments.y[i] ?? 0) - y);
      if (d <= radius && d < bestWorkDist) {
        bestWorkDist = d;
        const handle = roadWorks.segments.handles[i] ?? 0;
        bestWork = { ownHandle: handle, subject: { kind: 'road_segment', handle } };
      }
    }
  }
  const salvage = salvageChannel(snapshot);
  if (salvage !== null) {
    for (let i = 0; i < salvage.handles.length; i++) {
      const d = Math.hypot((salvage.x[i] ?? 0) - x, (salvage.y[i] ?? 0) - y);
      if (d <= radius && d < bestWorkDist) {
        bestWorkDist = d;
        const handle = salvage.handles[i] ?? 0;
        bestWork = { ownHandle: null, subject: { kind: 'salvage', handle } };
      }
    }
  }
  if (bestWork !== null) {
    return bestWork;
  }

  // (4) VisionMemoryChannel footprint containing (x, y).
  const memory = visionMemoryChannel(snapshot);
  if (memory !== null) {
    for (let i = 0; i < memory.handles.length; i++) {
      const kindIndex = memory.kind[i] ?? 0;
      const kind = db.structures.byIndex(kindIndex);
      const mx = memory.x[i] ?? 0;
      const my = memory.y[i] ?? 0;
      if (
        kind !== undefined &&
        x >= mx &&
        x < mx + kind.footprint.w &&
        y >= my &&
        y < my + kind.footprint.h
      ) {
        return {
          ownHandle: null,
          subject: {
            kind: 'memory',
            handle: memory.handles[i] ?? 0,
            kindIndex,
            x: mx,
            y: my,
            faction: memory.faction[i] ?? 0,
            state: memory.state[i] ?? 0,
          },
        };
      }
    }
  }

  // (5) Terrain cell fallback.
  return {
    ownHandle: null,
    subject: { kind: 'cell', x: Math.floor(x), y: Math.floor(y) },
  };
}

// Picks a cancellable/demolishable own structure (by footprint) or road
// segment (within radius) at (x, y), returning its handle and refunds.
export function pickDemolishableAt(
  db: ContentDb,
  snapshot: Snapshot | null,
  observer: number,
  x: number,
  y: number,
  radius = 0.6,
): DemolishPick | null {
  const structures = structuresChannel(snapshot);
  const roadWorks = roadWorksChannel(snapshot);
  const candidate =
    findOwnStructureAt(db, structures, observer, x, y) ??
    findNearestRoadSegment(roadWorks, x, y, radius);
  if (candidate === null) {
    return null;
  }
  const result = classifyCancelSelection(db, structures, roadWorks, observer, [candidate]);
  if (result.cancellable.length === 0) {
    return null;
  }
  return { handle: candidate, refunds: result.refunds };
}
