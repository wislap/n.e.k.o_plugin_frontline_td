// Squad formation layout, slot projection, virtual leader anchor,
// corridor width probing, and cruise speed synchronization (ADR 0054).
// Pure deterministic math only (ADR 0006 purity zone).
import { distance } from '../../../core/index';
import type { EntityId } from '../../../core/index';
import type { PathingApi } from '../../pathing/sim/index';
import {
  clearanceAnchorCell,
  clearanceAnchorCenter,
  clearanceFootprintSize,
  spiralOffsets,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import type { SquadAnchor } from './state';

export const FORMATION_PAD = 0.35;
export const LEADER_MAX_LEAD = 4.0;
export const GUIDE_LOOKAHEAD = 2.5;
export const MIN_WIDTH_SCALE = 0.25;

const PROJECT_SPIRAL_RING = 10;

export interface FormationMemberInfo {
  handle: number;
  id: EntityId;
  x: number;
  y: number;
  radius: number;
  speed: number;
  cls: number;
  tier: ClearanceTier;
  range: number;
}

function rangeSortKey(range: number): number {
  return range <= 0 ? 1e9 : Math.round(range * 2);
}

function sortFormationMembers(members: readonly FormationMemberInfo[]): FormationMemberInfo[] {
  return [...members].sort(
    (a, b) =>
      rangeSortKey(a.range) - rangeSortKey(b.range) || b.radius - a.radius || a.handle - b.handle,
  );
}

// Compute role-ordered local formation offsets (fwd, right) and total
// formation halfWidth. Shorter-range / heavier units take vanguard center;
// lighter / longer-range units spread into flanks and rear rows.
export function computeFormationLayout(members: readonly FormationMemberInfo[]): {
  offsets: Map<number, { fwd: number; right: number }>;
  halfWidth: number;
} {
  const offsets = new Map<number, { fwd: number; right: number }>();
  if (members.length === 0) {
    return { offsets, halfWidth: 0 };
  }
  const sorted = sortFormationMembers(members);
  const cols = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(sorted.length * 1.4))));
  const rows: FormationMemberInfo[][] = [];
  for (let i = 0; i < sorted.length; i += cols) {
    rows.push(sorted.slice(i, i + cols));
  }

  // Row spacing along fwd: row 0 sits at the positive vanguard, later rows
  // step backward along -fwd by maxR[row - 1] + maxR[row] + FORMATION_PAD.
  const rowMaxR = rows.map((row) => {
    let maxR = 0;
    for (const m of row) {
      if (m.radius > maxR) {
        maxR = m.radius;
      }
    }
    return maxR;
  });
  const rawBack: number[] = [0];
  for (let r = 1; r < rows.length; r++) {
    const prev = rawBack[r - 1] ?? 0;
    const prevR = rowMaxR[r - 1] ?? 0;
    const curR = rowMaxR[r] ?? 0;
    rawBack.push(prev + prevR + curR + FORMATION_PAD);
  }
  const midBack = ((rawBack[0] ?? 0) + (rawBack[rows.length - 1] ?? 0)) * 0.5;

  let halfWidth = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const fwd = midBack - (rawBack[r] ?? 0);
    // Reorder center-outward: index 0 at center, then alternating + / - flanks.
    const first = row[0];
    if (first === undefined) {
      continue;
    }
    const ordered: FormationMemberInfo[] = [first];
    for (let k = 1; k < row.length; k++) {
      const m = row[k];
      if (m === undefined) {
        continue;
      }
      if (k % 2 === 1) {
        ordered.push(m);
      } else {
        ordered.unshift(m);
      }
    }
    const rawRight: number[] = [0];
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (prev === undefined || cur === undefined) {
        continue;
      }
      rawRight.push((rawRight[i - 1] ?? 0) + prev.radius + cur.radius + FORMATION_PAD);
    }
    const midRight = ((rawRight[0] ?? 0) + (rawRight[ordered.length - 1] ?? 0)) * 0.5;
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i];
      if (m === undefined) {
        continue;
      }
      const right = (rawRight[i] ?? 0) - midRight;
      offsets.set(m.handle, { fwd, right });
      const span = Math.abs(right) + m.radius;
      if (span > halfWidth) {
        halfWidth = span;
      }
    }
  }
  return { offsets, halfWidth };
}

export function markFootprintCells(
  occupied: Set<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  tier: ClearanceTier,
): void {
  const ax = clearanceAnchorCell(x, tier);
  const ay = clearanceAnchorCell(y, tier);
  const size = clearanceFootprintSize(tier);
  for (let dy = 0; dy < size; dy++) {
    const cy = ay + dy;
    if (cy < 0 || cy >= height) {
      continue;
    }
    for (let dx = 0; dx < size; dx++) {
      const cx = ax + dx;
      if (cx < 0 || cx >= width) {
        continue;
      }
      occupied.add(cy * width + cx);
    }
  }
}

export function isFootprintFree(
  occupied: ReadonlySet<number>,
  width: number,
  x: number,
  y: number,
  tier: ClearanceTier,
): boolean {
  const ax = clearanceAnchorCell(x, tier);
  const ay = clearanceAnchorCell(y, tier);
  const size = clearanceFootprintSize(tier);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (occupied.has((ay + dy) * width + (ax + dx))) {
        return false;
      }
    }
  }
  return true;
}

export function projectFormationSlots(
  terrain: TerrainApi,
  pathing: PathingApi | null,
  goalId: number | null,
  centerX: number,
  centerY: number,
  hx: number,
  hy: number,
  members: readonly FormationMemberInfo[],
  offsets: ReadonlyMap<number, { fwd: number; right: number }>,
  widthScale: number,
  depthScale: number,
  reservedCells?: ReadonlySet<number>,
): Map<number, { x: number; y: number }> {
  const result = new Map<number, { x: number; y: number }>();
  const usedCells = new Set<number>(reservedCells);
  const rx = -hy;
  const ry = hx;
  const ordered = sortFormationMembers(members);

  for (const m of ordered) {
    const off = offsets.get(m.handle) ?? { fwd: 0, right: 0 };
    const px = centerX + hx * off.fwd * depthScale + rx * off.right * widthScale;
    const py = centerY + hy * off.fwd * depthScale + ry * off.right * widthScale;
    const baseAx = Math.min(Math.max(0, clearanceAnchorCell(px, m.tier)), terrain.width - 1);
    const baseAy = Math.min(Math.max(0, clearanceAnchorCell(py, m.tier)), terrain.height - 1);

    let chosen: { x: number; y: number } | null = null;
    let fallback: { x: number; y: number } | null = null;

    for (const [dx, dy] of spiralOffsets(baseAx, baseAy, terrain.width, terrain.height)) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > PROJECT_SPIRAL_RING) {
        break;
      }
      const ax = baseAx + dx;
      const ay = baseAy + dy;
      if (!terrain.passable(ax, ay, m.cls, m.tier)) {
        continue;
      }
      if (goalId !== null && pathing !== null && pathing.directionAt(goalId, ax, ay) === null) {
        continue;
      }
      const cx = clearanceAnchorCenter(ax, m.tier);
      const cy = clearanceAnchorCenter(ay, m.tier);
      if (fallback === null) {
        fallback = { x: cx, y: cy };
      }
      if (isFootprintFree(usedCells, terrain.width, cx, cy, m.tier)) {
        chosen = { x: cx, y: cy };
        break;
      }
    }

    const slot = chosen ??
      fallback ?? {
        x: Math.min(Math.max(0.5, centerX), terrain.width - 0.5),
        y: Math.min(Math.max(0.5, centerY), terrain.height - 0.5),
      };
    markFootprintCells(usedCells, terrain.width, terrain.height, slot.x, slot.y, m.tier);
    result.set(m.handle, slot);
  }

  return result;
}

export function probeCorridorWidth(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  px: number,
  py: number,
  rx: number,
  ry: number,
  maxHalf: number,
): { availHalf: number; centerBias: number } {
  const limit = Math.max(1.5, maxHalf + 1.0);
  let rightClear = 0;
  for (let d = 0.5; d <= limit + 1e-9; d += 0.5) {
    const sx = px + rx * d;
    const sy = py + ry * d;
    if (
      !terrain.passable(clearanceAnchorCell(sx, tier), clearanceAnchorCell(sy, tier), cls, tier)
    ) {
      break;
    }
    rightClear = d;
  }
  let leftClear = 0;
  for (let d = 0.5; d <= limit + 1e-9; d += 0.5) {
    const sx = px - rx * d;
    const sy = py - ry * d;
    if (
      !terrain.passable(clearanceAnchorCell(sx, tier), clearanceAnchorCell(sy, tier), cls, tier)
    ) {
      break;
    }
    leftClear = d;
  }
  return {
    availHalf: (leftClear + rightClear) * 0.5,
    centerBias: Math.max(-1.5, Math.min(1.5, (rightClear - leftClear) * 0.5)),
  };
}

export function advanceLeaderAnchor(
  terrain: TerrainApi,
  pathing: PathingApi,
  goalId: number,
  anchor: SquadAnchor,
  goalX: number,
  goalY: number,
  centroidX: number,
  centroidY: number,
  cls: number,
  tier: ClearanceTier,
  cruiseSpeed: number,
  halfWidth: number,
  periodTicks: number,
): { guideCenterX: number; guideCenterY: number; widthScale: number; depthScale: number } {
  let leadDist = distance(centroidX, centroidY, anchor.x, anchor.y);
  if (leadDist > LEADER_MAX_LEAD * 2) {
    anchor.x += (centroidX - anchor.x) * 0.5;
    anchor.y += (centroidY - anchor.y) * 0.5;
    leadDist = distance(centroidX, centroidY, anchor.x, anchor.y);
  }

  if (leadDist < LEADER_MAX_LEAD && distance(anchor.x, anchor.y, goalX, goalY) > 0.75) {
    let rem = cruiseSpeed * periodTicks * Math.max(0.25, 1 - leadDist / (LEADER_MAX_LEAD * 1.4));
    while (rem > 1e-6) {
      if (distance(anchor.x, anchor.y, goalX, goalY) <= 0.75) {
        break;
      }
      const dir = pathing.smoothDirectionAt(goalId, anchor.x, anchor.y);
      if (dir === null || (dir.dx === 0 && dir.dy === 0)) {
        break;
      }
      const dLen = Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
      if (dLen <= 1e-9) {
        break;
      }
      const ux = dir.dx / dLen;
      const uy = dir.dy / dLen;
      const step = Math.min(0.5, rem);
      const nx = anchor.x + ux * step;
      const ny = anchor.y + uy * step;
      if (!terrain.inBounds(Math.floor(nx), Math.floor(ny))) {
        break;
      }
      anchor.x = nx;
      anchor.y = ny;
      const bx = 0.65 * anchor.hx + 0.35 * ux;
      const by = 0.65 * anchor.hy + 0.35 * uy;
      const bLen = Math.sqrt(bx * bx + by * by);
      if (bLen > 1e-9) {
        anchor.hx = bx / bLen;
        anchor.hy = by / bLen;
      } else {
        anchor.hx = ux;
        anchor.hy = uy;
      }
      rem -= step;
    }
  }

  let gx = anchor.x;
  let gy = anchor.y;
  let lookRem = GUIDE_LOOKAHEAD;
  while (lookRem > 1e-6) {
    if (distance(gx, gy, goalX, goalY) <= 0.75) {
      break;
    }
    const dir = pathing.smoothDirectionAt(goalId, gx, gy);
    if (dir === null || (dir.dx === 0 && dir.dy === 0)) {
      break;
    }
    const dLen = Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
    if (dLen <= 1e-9) {
      break;
    }
    const step = Math.min(0.5, lookRem);
    const nx = gx + (dir.dx / dLen) * step;
    const ny = gy + (dir.dy / dLen) * step;
    if (
      !terrain.inBounds(Math.floor(nx), Math.floor(ny)) ||
      !terrain.passable(clearanceAnchorCell(nx, tier), clearanceAnchorCell(ny, tier), cls, tier)
    ) {
      break;
    }
    gx = nx;
    gy = ny;
    lookRem -= step;
  }

  const rx = -anchor.hy;
  const ry = anchor.hx;
  const { availHalf, centerBias } = probeCorridorWidth(
    terrain,
    cls,
    tier,
    gx,
    gy,
    rx,
    ry,
    halfWidth,
  );
  const targetScale =
    halfWidth <= 0.5 ? 1 : Math.max(MIN_WIDTH_SCALE, Math.min(1, (availHalf - 0.25) / halfWidth));
  const blend = targetScale < anchor.widthScale ? 0.55 : 0.35;
  anchor.widthScale = anchor.widthScale + (targetScale - anchor.widthScale) * blend;
  const depthScale = 1 + (1 - anchor.widthScale) * 0.65;

  return {
    guideCenterX: gx + rx * centerBias,
    guideCenterY: gy + ry * centerBias,
    widthScale: anchor.widthScale,
    depthScale,
  };
}

export function computeCruiseCap(
  memberSpeed: number,
  mx: number,
  my: number,
  anchorSlotX: number,
  anchorSlotY: number,
  hx: number,
  hy: number,
  cruiseSpeed: number,
  strayDist: number,
): number {
  const dx = mx - anchorSlotX;
  const dy = my - anchorSlotY;
  if (dx * dx + dy * dy > strayDist * strayDist) {
    return 0;
  }
  const ahead = dx * hx + dy * hy;
  if (ahead < -0.75) {
    return 0;
  }
  if (memberSpeed > cruiseSpeed * 1.02 || ahead > 0.75) {
    const base = Math.min(memberSpeed, cruiseSpeed);
    const scale = ahead > 0.75 ? Math.max(0.55, 1 - (ahead - 0.75) * 0.15) : 1;
    const cap = base * scale;
    return cap < memberSpeed * 0.985 ? cap : 0;
  }
  return 0;
}
