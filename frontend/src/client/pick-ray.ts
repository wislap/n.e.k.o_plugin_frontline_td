// 3D ray-volume entity picking (ADR 0060): tests elevated unit cylinders and
// structure AABBs along a 3D cursor ray before falling back to ground-point
// picking so shallow-pitch camera angles still click tall silhouettes accurately
// while closer terrain occludes entities behind cliffs.
import type { ContentDb } from '../content/index';
import type { Snapshot } from '../core/index';
import {
  RoadWorksChannel,
  STATE_BLUEPRINT,
  STATE_RUIN,
  STATE_SITE,
  STATE_WAITING,
  type RoadWorks,
} from '../features/construction/protocol';
import { classifyCancelSelection } from '../features/construction/rules/index';
import { DenseUnitsChannel, type DenseUnits } from '../features/units/protocol';
import {
  pickDemolishableAt,
  pickSubjectAt,
  structuresChannel,
  type DemolishPick,
  type PickResult,
} from './pick';

interface PickRay {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

function normalizeRay(ray: PickRay): PickRay | null {
  const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
  if (len <= 0) {
    return null;
  }
  return {
    origin: ray.origin,
    dir: { x: ray.dir.x / len, y: ray.dir.y / len, z: ray.dir.z / len },
  };
}

function surfaceHeightAt(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  heightStep: number,
): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
    return 0;
  }
  return (heights[cy * width + cx] ?? 0) * heightStep;
}

function rayAabbHitT(
  ray: PickRay,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  const axes: readonly [number, number, number, number][] = [
    [ray.origin.x, ray.dir.x, minX, maxX],
    [ray.origin.y, ray.dir.y, minY, maxY],
    [ray.origin.z, ray.dir.z, minZ, maxZ],
  ];
  for (const [o, d, bMin, bMax] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < bMin || o > bMax) {
        return null;
      }
      continue;
    }
    const inv = 1 / d;
    const t0 = (bMin - o) * inv;
    const t1 = (bMax - o) * inv;
    tMin = Math.max(tMin, Math.min(t0, t1));
    tMax = Math.min(tMax, Math.max(t0, t1));
    if (tMax < tMin) {
      return null;
    }
  }
  return tMin;
}

function rayCylinderHitT(
  ray: PickRay,
  cx: number,
  baseY: number,
  topY: number,
  cz: number,
  radius: number,
): number | null {
  let tYMin = Number.NEGATIVE_INFINITY;
  let tYMax = Number.POSITIVE_INFINITY;
  if (Math.abs(ray.dir.y) < 1e-9) {
    if (ray.origin.y < baseY || ray.origin.y > topY) {
      return null;
    }
  } else {
    const ty0 = (baseY - ray.origin.y) / ray.dir.y;
    const ty1 = (topY - ray.origin.y) / ray.dir.y;
    tYMin = Math.min(ty0, ty1);
    tYMax = Math.max(ty0, ty1);
  }

  const dx = ray.origin.x - cx;
  const dz = ray.origin.z - cz;
  const a = ray.dir.x * ray.dir.x + ray.dir.z * ray.dir.z;
  const c = dx * dx + dz * dz - radius * radius;
  if (a < 1e-10) {
    if (c > 0) {
      return null;
    }
    const enter = Math.max(0, tYMin);
    return tYMax < enter ? null : enter;
  }

  const b = 2 * (dx * ray.dir.x + dz * ray.dir.z);
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    return null;
  }
  const sqrtD = Math.sqrt(disc);
  const tCyl0 = (-b - sqrtD) / (2 * a);
  const tCyl1 = (-b + sqrtD) / (2 * a);
  const enter = Math.max(0, tCyl0, tYMin);
  const exit = Math.min(tCyl1, tYMax);
  return exit < enter ? null : enter;
}

function groundMaxT(
  ray: PickRay,
  groundHit: { x: number; y: number } | null,
  heights: ArrayLike<number>,
  mapDims: { width: number; height: number },
  heightStep: number,
): number {
  if (groundHit === null) {
    return Number.POSITIVE_INFINITY;
  }
  const gy = surfaceHeightAt(
    heights,
    mapDims.width,
    mapDims.height,
    groundHit.x,
    groundHit.y,
    heightStep,
  );
  return (
    Math.hypot(groundHit.x - ray.origin.x, gy - ray.origin.y, groundHit.y - ray.origin.z) + 0.35
  );
}

export function pickSubjectByRay(
  db: ContentDb,
  mapDims: { width: number; height: number },
  heights: ArrayLike<number>,
  heightStep: number,
  ray: PickRay,
  groundHit: { x: number; y: number } | null,
  snapshot: Snapshot | null,
  observer: number,
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>,
  radius = 0.6,
): PickResult {
  const nRay = normalizeRay(ray);
  if (nRay !== null) {
    const maxT = groundMaxT(nRay, groundHit, heights, mapDims, heightStep);
    const unitKindByHandle = new Map<number, number>();
    const denseUnits = (snapshot?.channels[DenseUnitsChannel.id] as DenseUnits | undefined) ?? null;
    if (denseUnits !== null) {
      for (let i = 0; i < denseUnits.handles.length; i++) {
        unitKindByHandle.set(denseUnits.handles[i] ?? 0, denseUnits.kind[i] ?? 0);
      }
    }

    let bestT = Infinity;
    let bestIsOwnUnit = false;
    let bestPick: PickResult | null = null;

    for (const [handle, u] of units) {
      const kindIdx = unitKindByHandle.get(handle);
      const unitDef = kindIdx !== undefined ? db.units.byIndex(kindIdx) : undefined;
      const uRadius = unitDef?.radius ?? 0.35;
      const scale = unitDef?.visual.scale ?? 1;
      const baseY = surfaceHeightAt(heights, mapDims.width, mapDims.height, u.x, u.y, heightStep);
      const t = rayCylinderHitT(
        nRay,
        u.x,
        baseY,
        baseY + Math.max(0.6 * scale + 0.25, 0.7),
        u.y,
        Math.max(uRadius * scale * 1.35, 0.45),
      );
      if (t === null || t > maxT) {
        continue;
      }
      const isOwn = u.faction === observer;
      if (t + 1e-6 < bestT || (Math.abs(t - bestT) <= 1e-6 && isOwn && !bestIsOwnUnit)) {
        bestT = t;
        bestIsOwnUnit = isOwn;
        bestPick = isOwn
          ? { ownHandle: handle, subject: { kind: 'own_unit', handle } }
          : { ownHandle: null, subject: { kind: 'hostile_unit', handle } };
      }
    }

    const structures = structuresChannel(snapshot);
    if (structures !== null) {
      for (let i = 0; i < structures.handles.length; i++) {
        const kindIdx = structures.kind[i] ?? 0;
        const kind = db.structures.byIndex(kindIdx);
        if (kind === undefined) {
          continue;
        }
        const sx = structures.x[i] ?? 0;
        const sy = structures.y[i] ?? 0;
        const cx = sx + kind.footprint.w / 2;
        const cy = sy + kind.footprint.h / 2;
        const baseY = surfaceHeightAt(heights, mapDims.width, mapDims.height, cx, cy, heightStep);
        const state = structures.state[i] ?? 0;
        const full = kind.visual.height;
        const boxHeight =
          state === STATE_RUIN
            ? 0.35
            : state === STATE_BLUEPRINT || state === STATE_WAITING
              ? full * 0.5
              : state === STATE_SITE
                ? Math.max(0.35, full * ((structures.progressBp[i] ?? 0) / 10000))
                : full;
        const t = rayAabbHitT(
          nRay,
          sx,
          baseY,
          sy,
          sx + kind.footprint.w,
          baseY + Math.max(0.3, boxHeight),
          sy + kind.footprint.h,
        );
        // Slightly favour an already-hit unit right in front of or standing
        // inside a building pad when ray hits nearly overlap.
        if (t === null || t > maxT || t >= bestT - 0.15) {
          continue;
        }
        bestT = t;
        const handle = structures.handles[i] ?? 0;
        const faction = structures.faction[i] ?? 0;
        if (state === STATE_RUIN) {
          bestPick = { ownHandle: null, subject: { kind: 'ruin', handle } };
        } else if (faction === observer) {
          bestPick = { ownHandle: handle, subject: { kind: 'own_structure', handle } };
        } else {
          bestPick = { ownHandle: null, subject: { kind: 'hostile_structure', handle } };
        }
      }
    }

    if (bestPick !== null) {
      return bestPick;
    }
  }

  return groundHit !== null
    ? pickSubjectAt(db, mapDims, snapshot, observer, units, groundHit.x, groundHit.y, radius)
    : { ownHandle: null, subject: null };
}

export function pickDemolishableByRay(
  db: ContentDb,
  mapDims: { width: number; height: number },
  heights: ArrayLike<number>,
  heightStep: number,
  ray: PickRay,
  groundHit: { x: number; y: number } | null,
  snapshot: Snapshot | null,
  observer: number,
  radius = 0.6,
): DemolishPick | null {
  const structures = structuresChannel(snapshot);
  const roadWorks = (snapshot?.channels[RoadWorksChannel.id] as RoadWorks | undefined) ?? null;
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
