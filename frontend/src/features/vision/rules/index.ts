// Pure client-facing vision helpers (M5 batch D): cell visibility
// against the 'frontline_td:vision.state#<faction>' layer (0 unseen,
// 1 explored, 2 visible), fog instance bucketing for the render layer,
// and the hostile-excluder merge used by the build overlay and the
// placement-view adapter. No sim imports — render code reads these.
import type { ContentDb } from '../../../content/index';
import { STATE_OPERATIONAL } from '../../construction/protocol';

// True when the cell containing position (x, y) is currently visible
// (layer value 2) to the layer's owner.
export function isCellVisible(
  layer: ArrayLike<number> | undefined,
  width: number,
  x: number,
  y: number,
): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (layer === undefined || cx < 0 || cy < 0 || cx >= width) {
    return false;
  }
  return (layer[cy * width + cx] ?? 0) === 2;
}

export interface FogBuckets {
  // Flat cell indices (y * width + x).
  unexplored: number[];
  explored: number[];
}

// Buckets every cell of the layer into unexplored (0) and explored (1);
// visible cells (2) get no quad.
export function fogBuckets(layer: ArrayLike<number>, width: number, height: number): FogBuckets {
  const unexplored: number[] = [];
  const explored: number[] = [];
  for (let i = 0; i < width * height; i++) {
    const v = layer[i] ?? 0;
    if (v === 0) {
      unexplored.push(i);
    } else if (v === 1) {
      explored.push(i);
    }
  }
  return { unexplored, explored };
}

// Minimal structure-row shape shared by the structures channel and the
// vision memory channel (both carry the same columns).
export interface StructureRows {
  handles: { length: number };
  kind: ArrayLike<number>;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  faction: ArrayLike<number>;
  state: ArrayLike<number>;
}

export interface ExclusionCircle {
  cx: number;
  cy: number;
  r: number;
}

// Operational hostile structures carrying an `exclusion` field, merged
// across row sets (structures channel first, then vision memory rows —
// memory rows by definition are not currently visible, so they never
// duplicate a live channel row).
export function hostileExcluders(
  db: ContentDb,
  isHostile: (faction: number) => boolean,
  rows: readonly (StructureRows | undefined)[],
): ExclusionCircle[] {
  const out: ExclusionCircle[] = [];
  for (const set of rows) {
    if (set === undefined) {
      continue;
    }
    for (let i = 0; i < set.handles.length; i++) {
      const kind = db.structures.byIndex(set.kind[i] ?? -1);
      if (kind?.exclusion === undefined) {
        continue;
      }
      if ((set.state[i] ?? -1) !== STATE_OPERATIONAL || !isHostile(set.faction[i] ?? -1)) {
        continue;
      }
      out.push({
        cx: (set.x[i] ?? 0) + kind.footprint.w / 2,
        cy: (set.y[i] ?? 0) + kind.footprint.h / 2,
        r: kind.exclusion,
      });
    }
  }
  return out;
}
