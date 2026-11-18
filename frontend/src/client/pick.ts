// Entity picking from snapshot channels (M3 D): click picks the nearest
// own unit within the click radius, else an own structure/blueprint whose
// footprint contains the ground point, else salvage near the point. Pure,
// so selection priority is unit-testable.
import type { Snapshot } from '../core/index';
import type { ContentDb } from '../content/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../features/construction/protocol';

export function structuresChannel(snapshot: Snapshot | null): ConstructionStructures | null {
  return (snapshot?.channels[StructuresChannel.id] as ConstructionStructures | undefined) ?? null;
}

function salvageChannel(snapshot: Snapshot | null): ConstructionSalvage | null {
  return (snapshot?.channels[SalvageChannel.id] as ConstructionSalvage | undefined) ?? null;
}

function roadWorksChannel(snapshot: Snapshot | null): RoadWorks | null {
  return (snapshot?.channels[RoadWorksChannel.id] as RoadWorks | undefined) ?? null;
}

// Click selection: nearest own unit inside `radius` wins; an own
// structure/blueprint/salvage is only picked when no unit is near.
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
// (ties by row order); falls back to own salvage within `radius` cells.
function pickStructureAt(
  db: ContentDb,
  snapshot: Snapshot | null,
  observer: number,
  x: number,
  y: number,
  radius = 0.6,
): number | null {
  const structures = structuresChannel(snapshot);
  if (structures !== null) {
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
