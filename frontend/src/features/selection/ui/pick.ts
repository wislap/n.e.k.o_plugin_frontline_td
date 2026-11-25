// Entity and subject picking from snapshot channels (ADR 0048/0062):
// `pickSubjectAt` resolves any hover/click target (own/hostile unit,
// ruin, own/hostile structure, road segment, salvage, fog memory, or
// terrain cell); `pickAt` remains for own-entity compatibility. The
// candidate finders live with construction's demolishable picking.
import { readChannel, type Snapshot } from '../../../core/index';
import type { ContentDb } from '../../../content/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  STATE_RUIN,
  StructuresChannel,
} from '../../construction/protocol';
import { findOwnStructureAt } from '../../construction/ui/index';
import { VisionMemoryChannel } from '../../vision/protocol';
import type { HoverSubject, PinnableSubject } from '../../../client/inspector-store';

export interface PickResult {
  ownHandle: number | null;
  subject: HoverSubject | null;
}

// The pin subject for a selected own handle: unit when the interpolated
// unit map contains it, else the own structure or road segment carrying
// the handle (verbatim from the old canvas dispatch).
export function ownSubjectForHandle(
  snapshot: Snapshot | null,
  observer: number,
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>,
  handle: number,
): PinnableSubject {
  const unit = units.get(handle);
  if (unit !== undefined && unit.faction === observer) {
    return { kind: 'own_unit', handle };
  }
  const structures = readChannel(snapshot, StructuresChannel);
  if (structures !== null) {
    for (let i = 0; i < structures.handles.length; i++) {
      if (structures.handles[i] === handle && (structures.faction[i] ?? 0) === observer) {
        return { kind: 'own_structure', handle };
      }
    }
  }
  const roadWorks = readChannel(snapshot, RoadWorksChannel);
  if (roadWorks !== null) {
    for (let i = 0; i < roadWorks.segments.handles.length; i++) {
      if (roadWorks.segments.handles[i] === handle) {
        return { kind: 'road_segment', handle };
      }
    }
  }
  return { kind: 'own_unit', handle };
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
  const ownStructure = findOwnStructureAt(
    db,
    readChannel(snapshot, StructuresChannel),
    observer,
    x,
    y,
  );
  if (ownStructure !== null) {
    return ownStructure;
  }
  // Salvage and road-work segments share one nearest-candidate search:
  // the salvage channel always exists, so early-returning here would
  // make road segments unpickable.
  let best: number | null = null;
  let bestDist = radius;
  const salvage = readChannel(snapshot, SalvageChannel);
  if (salvage !== null) {
    for (let i = 0; i < salvage.handles.length; i++) {
      const d = Math.hypot((salvage.x[i] ?? 0) - x, (salvage.y[i] ?? 0) - y);
      if (d <= bestDist) {
        bestDist = d;
        best = salvage.handles[i] ?? null;
      }
    }
  }
  const roadWorks = readChannel(snapshot, RoadWorksChannel);
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
  const structures = readChannel(snapshot, StructuresChannel);
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
  const roadWorks = readChannel(snapshot, RoadWorksChannel);
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
  const salvage = readChannel(snapshot, SalvageChannel);
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
  const memory = readChannel(snapshot, VisionMemoryChannel);
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
