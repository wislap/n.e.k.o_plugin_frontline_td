// Demolishable-target picking (ADR 0062 step 4b): resolves a cancellable
// own structure or road segment under a ground point or a 3D cursor ray,
// returning handle + refunds. Candidate enumeration helpers come from
// features/selection; ray math from render/picking. Moved verbatim from
// client/pick.ts and client/pick-ray.ts.
import type { ContentDb } from '../../../content/index';
import { readChannel, type Snapshot } from '../../../core/index';
import {
  groundMaxT,
  normalizeRay,
  rayAabbHitT,
  surfaceHeightAt,
  type Ray,
} from '../../../client/picking';
import { classifyCancelSelection } from '../rules/index';
import {
  RoadWorksChannel,
  STATE_BLUEPRINT,
  STATE_WAITING,
  StructuresChannel,
  type ConstructionStructures,
  type RoadWorks,
} from '../protocol';

export interface DemolishPick {
  handle: number;
  refunds: { cargo: number; milli: number }[];
}

// Own structure whose footprint contains (x, y) — also used by
// selection's pickAt through the ui index.
export function findOwnStructureAt(
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
  const structures = readChannel(snapshot, StructuresChannel);
  const roadWorks = readChannel(snapshot, RoadWorksChannel);
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

export function pickDemolishableByRay(
  db: ContentDb,
  mapDims: { width: number; height: number },
  heights: ArrayLike<number>,
  heightStep: number,
  ray: Ray,
  groundHit: { x: number; y: number } | null,
  snapshot: Snapshot | null,
  observer: number,
  radius = 0.6,
): DemolishPick | null {
  const structures = readChannel(snapshot, StructuresChannel);
  const roadWorks = readChannel(snapshot, RoadWorksChannel);
  const nRay = normalizeRay(ray);
  if (nRay !== null && structures !== null) {
    const maxT = groundMaxT(nRay, groundHit, heights, mapDims, heightStep);
    let bestT = Infinity;
    let bestPick: DemolishPick | null = null;
    for (let i = 0; i < structures.handles.length; i++) {
      if ((structures.faction[i] ?? 0) !== observer) {
        continue;
      }
      const handle = structures.handles[i] ?? 0;
      const result = classifyCancelSelection(db, structures, roadWorks, observer, [handle]);
      if (result.cancellable.length === 0) {
        continue;
      }
      const kind = db.structures.byIndex(structures.kind[i] ?? 0);
      if (kind === undefined) {
        continue;
      }
      const sx = structures.x[i] ?? 0;
      const sy = structures.y[i] ?? 0;
      const baseY = surfaceHeightAt(
        heights,
        mapDims.width,
        mapDims.height,
        sx + kind.footprint.w / 2,
        sy + kind.footprint.h / 2,
        heightStep,
      );
      const state = structures.state[i] ?? 0;
      const full = kind.visual.height;
      const boxHeight = state === STATE_BLUEPRINT || state === STATE_WAITING ? full * 0.5 : full;
      const t = rayAabbHitT(
        nRay,
        sx,
        baseY,
        sy,
        sx + kind.footprint.w,
        baseY + Math.max(0.3, boxHeight),
        sy + kind.footprint.h,
      );
      if (t !== null && t <= maxT && t < bestT) {
        bestT = t;
        bestPick = { handle, refunds: result.refunds };
      }
    }
    if (bestPick !== null) {
      return bestPick;
    }
  }

  return groundHit !== null
    ? pickDemolishableAt(db, snapshot, observer, groundHit.x, groundHit.y, radius)
    : null;
}
