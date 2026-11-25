// 3D ray-volume entity picking (ADR 0060/0062): tests elevated unit
// cylinders and structure AABBs along a 3D cursor ray before falling back
// to ground-point picking so shallow-pitch camera angles still click tall
// silhouettes accurately while closer terrain occludes entities behind
// cliffs. Ray math lives in render/picking.
import type { ContentDb } from '../../../content/index';
import { readChannel, type Snapshot } from '../../../core/index';
import {
  STATE_BLUEPRINT,
  STATE_RUIN,
  STATE_SITE,
  STATE_WAITING,
  StructuresChannel,
} from '../../construction/protocol';
import { DenseUnitsChannel } from '../../units/protocol';
import {
  groundMaxT,
  normalizeRay,
  rayAabbHitT,
  rayCylinderHitT,
  surfaceHeightAt,
  type Ray,
} from '../../../render/picking';
import { pickSubjectAt, type PickResult } from './pick';

export function pickSubjectByRay(
  db: ContentDb,
  mapDims: { width: number; height: number },
  heights: ArrayLike<number>,
  heightStep: number,
  ray: Ray,
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
    const denseUnits = readChannel(snapshot, DenseUnitsChannel);
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

    const structures = readChannel(snapshot, StructuresChannel);
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
