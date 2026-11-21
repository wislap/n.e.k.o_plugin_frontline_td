// Formation move slots (design §7.3): a move command spreads its units over
// a deterministic spiral of passable, goal-connected cells around the
// target, then assigns slots so the group's formation shape is preserved
// (nearest-slot greedy matching against a scaled formation offset).
import type { TerrainApi } from '../../terrain/sim/index';
import {
  CLEARANCE_STANDARD,
  clearanceAnchorCenter,
  clearanceFootprintSize,
  spiralOffsets,
  type ClearanceTier,
} from '../../terrain/rules/index';

// Spiral rings beyond this radius around the target are not considered.
const SLOT_RING_MARGIN = 8;

// Collect up to n passable cells connected to the goal (directionAt
// non-null) around (tx,ty) in spiral order. If none qualify the target
// cell itself is used (the caller has already checked it is passable).
export function collectSlots(
  terrain: TerrainApi,
  connected: (x: number, y: number) => boolean,
  cls: number,
  tx: number,
  ty: number,
  n: number,
  tier: ClearanceTier = CLEARANCE_STANDARD,
): { x: number; y: number }[] {
  const slots: { x: number; y: number }[] = [];
  const step = clearanceFootprintSize(tier);
  const maxRing = Math.ceil(Math.sqrt(n)) * step + SLOT_RING_MARGIN;
  for (const [dx, dy] of spiralOffsets(tx, ty, terrain.width, terrain.height)) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) > maxRing || slots.length >= n) {
      break;
    }
    const x = tx + dx;
    const y = ty + dy;
    if (!terrain.passable(x, y, cls, tier) || !connected(x, y)) {
      continue;
    }
    if (step > 1 && slots.some((s) => Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) < step)) {
      continue;
    }
    slots.push({ x, y });
  }
  if (slots.length === 0) {
    slots.push({ x: tx, y: ty });
  }
  return slots;
}

export interface SlotUnit {
  id: number;
  x: number;
  y: number;
}

// Each unit's desired slot point: slot centroid + formation offset scaled
// to the slot spread. A group tighter than its slot field expands to fill
// it; a wider group is compressed into it. Returned in units order.
export function formationDesired(
  units: readonly SlotUnit[],
  slotCells: readonly { x: number; y: number }[],
  tier: ClearanceTier = CLEARANCE_STANDARD,
): { x: number; y: number }[] {
  const n = units.length;
  // Slots are reused cyclically in spiral order when fewer than n qualify.
  const points = Array.from({ length: n }, (_, i) => {
    const c = slotCells[i % slotCells.length] ?? { x: 0, y: 0 };
    return { x: clearanceAnchorCenter(c.x, tier), y: clearanceAnchorCenter(c.y, tier) };
  });

  let ux = 0;
  let uy = 0;
  for (const u of units) {
    ux += u.x;
    uy += u.y;
  }
  const cx = ux / n;
  const cy = uy / n;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const px = sx / n;
  const py = sy / n;

  let us = 0;
  for (const u of units) {
    us += (u.x - cx) * (u.x - cx) + (u.y - cy) * (u.y - cy);
  }
  const unitSpread = Math.sqrt(us / n);
  let ss = 0;
  for (const p of points) {
    ss += (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
  }
  const slotSpread = Math.sqrt(ss / n);
  const k = unitSpread === 0 ? 1 : slotSpread / unitSpread;

  return units.map((u) => ({
    x: px + (u.x - cx) * k,
    y: py + (u.y - cy) * k,
  }));
}

// Assign each unit a slot point (cell centre), preserving formation:
// greedy nearest-to-desired matching, then 2-opt swaps until no crossed
// pair remains.
export function assignSlots(
  units: readonly SlotUnit[],
  slotCells: readonly { x: number; y: number }[],
  tier: ClearanceTier = CLEARANCE_STANDARD,
): Map<number, { x: number; y: number }> {
  const n = units.length;
  const points = Array.from({ length: n }, (_, i) => {
    const c = slotCells[i % slotCells.length] ?? { x: 0, y: 0 };
    return { x: clearanceAnchorCenter(c.x, tier), y: clearanceAnchorCenter(c.y, tier) };
  });
  const want = formationDesired(units, slotCells, tier);

  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= n;
  cy /= n;

  // Greedy pass: furthest-out units pick first; ties by ascending entity
  // id. Nearest free slot by squared distance, ties by lowest slot index.
  const order = units
    .map((u, i) => ({ u, i, d: (u.x - cx) * (u.x - cx) + (u.y - cy) * (u.y - cy) }))
    .sort((a, b) => b.d - a.d || a.u.id - b.u.id);
  const free = new Array<boolean>(n).fill(true);
  const slots = new Array<{ x: number; y: number }>(n);
  for (const { i } of order) {
    const w = want[i] ?? { x: 0, y: 0 };
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (!free[j]) {
        continue;
      }
      const p = points[j] ?? { x: 0, y: 0 };
      const d = (p.x - w.x) * (p.x - w.x) + (p.y - w.y) * (p.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    free[best] = false;
    slots[i] = points[best] ?? { x: 0, y: 0 };
  }

  // 2-opt pass: swap any pair whose crossed assignment is cheaper, until a
  // full pass makes no swap. The total squared cost strictly decreases, so
  // this terminates; the result has no crossing assignments.
  const EPS = 1e-9;
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < n; i++) {
      const wi = want[i] ?? { x: 0, y: 0 };
      for (let j = i + 1; j < n; j++) {
        const si = slots[i] ?? { x: 0, y: 0 };
        const wj = want[j] ?? { x: 0, y: 0 };
        const sj = slots[j] ?? { x: 0, y: 0 };
        const ii = (si.x - wi.x) * (si.x - wi.x) + (si.y - wi.y) * (si.y - wi.y);
        const jj = (sj.x - wj.x) * (sj.x - wj.x) + (sj.y - wj.y) * (sj.y - wj.y);
        const ij = (sj.x - wi.x) * (sj.x - wi.x) + (sj.y - wi.y) * (sj.y - wi.y);
        const ji = (si.x - wj.x) * (si.x - wj.x) + (si.y - wj.y) * (si.y - wj.y);
        if (ij + ji < ii + jj - EPS) {
          slots[i] = sj;
          slots[j] = si;
          swapped = true;
        }
      }
    }
  }

  const result = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < n; i++) {
    result.set(units[i]?.id ?? 0, slots[i] ?? { x: 0, y: 0 });
  }
  return result;
}
