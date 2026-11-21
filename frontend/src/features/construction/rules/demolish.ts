// Pure demolition/cancellation rules: footprint centering, salvage refund
// calculation, and selection classification shared by sim and client UI.
import type { ContentDb, ResolvedStructure } from '../../../content/index';
import { floorDiv } from '../../../core/index';
import {
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  STATE_SITE,
  STATE_WAITING,
  type ConstructionStructures,
  type RoadWorks,
} from '../protocol';

// Top-left cell of a footprint centered on (groundX, groundY).
export function centeredFootprint(
  groundX: number,
  groundY: number,
  footprint: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.floor(groundX - footprint.w / 2),
    y: Math.floor(groundY - footprint.h / 2),
  };
}

// Refund slots for a demolished building: build cost x salvageBp.
export function demolishRefund(kind: ResolvedStructure): { cargo: number; milli: number }[] {
  const bp = kind.build?.salvageBp ?? 0;
  return (kind.build?.cost ?? [])
    .map((c) => ({ cargo: c.cargo, milli: floorDiv(c.milli * bp, 10000) }))
    .filter((c) => c.milli > 0);
}

// Result of classifying a selection for cancellation or demolition.
type CancelClassification = {
  cancellable: number[];
  operational: number[];
  refunds: { cargo: number; milli: number }[];
};

// Classify selected handles into cancellable targets, operational buildings
// that require demolition confirmation, and aggregated demolition refunds.
export function classifyCancelSelection(
  db: ContentDb,
  structures: ConstructionStructures | null,
  roadWorks: RoadWorks | null,
  observer: number,
  targets: Iterable<number>,
): CancelClassification {
  const roadSegments = new Set<number>();
  if (roadWorks !== null) {
    for (let i = 0; i < roadWorks.segments.handles.length; i++) {
      const h = roadWorks.segments.handles[i];
      if (h !== undefined) {
        roadSegments.add(h);
      }
    }
  }

  const structureRows = new Map<number, number>();
  if (structures !== null) {
    for (let i = 0; i < structures.handles.length; i++) {
      const h = structures.handles[i];
      if (h !== undefined) {
        structureRows.set(h, i);
      }
    }
  }

  const cancellable: number[] = [];
  const operational: number[] = [];
  const refundByCargo = new Map<number, number>();

  for (const h of new Set(targets)) {
    if (roadSegments.has(h)) {
      cancellable.push(h);
      continue;
    }
    if (structures === null) {
      continue;
    }
    const row = structureRows.get(h);
    if (row === undefined || (structures.faction[row] ?? -1) !== observer) {
      continue;
    }
    const state = structures.state[row] ?? -1;
    if (state === STATE_BLUEPRINT || state === STATE_WAITING) {
      cancellable.push(h);
      continue;
    }
    const kind = db.structures.byIndex(structures.kind[row] ?? 0);
    if (kind?.build === undefined) {
      continue;
    }
    if (state === STATE_SITE) {
      cancellable.push(h);
    } else if (state === STATE_OPERATIONAL) {
      cancellable.push(h);
      operational.push(h);
      for (const r of demolishRefund(kind)) {
        refundByCargo.set(r.cargo, (refundByCargo.get(r.cargo) ?? 0) + r.milli);
      }
    }
  }

  const refunds = [...refundByCargo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cargo, milli]) => ({ cargo, milli }));

  return { cancellable, operational, refunds };
}
