// Squad formation layout, slot projection, and 1D Eikonal geodesic
// trimmed-median cruise speed synchronization (ADR 0054 / ADR 0057).
// Pure deterministic math only (ADR 0006 purity zone).
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

export const FORMATION_PAD = 0.35;

const PROJECT_SPIRAL_RING = 10;
// Column count from member count: near-square grid, capped.
const FORMATION_COLS_MAX = 8;
const FORMATION_COLS_ASPECT = 1.4;
// Slot projection acceptance: geodesic distance may exceed the euclidean
// detour by this factor plus a flat bias.
const MAX_GEODESIC_FACTOR = 2.5;
const MAX_GEODESIC_BIAS = 2.5;

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
  const cols = Math.max(
    1,
    Math.min(FORMATION_COLS_MAX, Math.ceil(Math.sqrt(sorted.length * FORMATION_COLS_ASPECT))),
  );
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
  reservedCells?: ReadonlySet<number>,
): Map<number, { x: number; y: number }> {
  const result = new Map<number, { x: number; y: number }>();
  const usedCells = new Set<number>(reservedCells);
  const rx = -hy;
  const ry = hx;
  const ordered = sortFormationMembers(members);

  for (const m of ordered) {
    const off = offsets.get(m.handle) ?? { fwd: 0, right: 0 };
    const px = centerX + hx * off.fwd + rx * off.right;
    const py = centerY + hy * off.fwd + ry * off.right;
    const baseAx = Math.min(Math.max(0, clearanceAnchorCell(px, m.tier)), terrain.width - 1);
    const baseAy = Math.min(Math.max(0, clearanceAnchorCell(py, m.tier)), terrain.height - 1);

    let chosen: { x: number; y: number } | null = null;
    let farChosen: { x: number; y: number } | null = null;
    let fallback: { x: number; y: number } | null = null;
    const checkNear = goalId !== null && pathing !== null;

    for (const [dx, dy] of spiralOffsets(baseAx, baseAy, terrain.width, terrain.height)) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > PROJECT_SPIRAL_RING) {
        break;
      }
      const ax = baseAx + dx;
      const ay = baseAy + dy;
      if (!terrain.passable(ax, ay, m.cls, m.tier)) {
        continue;
      }
      if (checkNear && pathing.directionAt(goalId, ax, ay) === null) {
        continue;
      }
      const cx = clearanceAnchorCenter(ax, m.tier);
      const cy = clearanceAnchorCenter(ay, m.tier);
      if (fallback === null) {
        fallback = { x: cx, y: cy };
      }
      if (!isFootprintFree(usedCells, terrain.width, cx, cy, m.tier)) {
        continue;
      }
      if (checkNear) {
        const gd = pathing.distanceAt(goalId, cx, cy);
        const euclidSq = (cx - centerX) * (cx - centerX) + (cy - centerY) * (cy - centerY);
        const maxGeodesic = Math.sqrt(euclidSq) * MAX_GEODESIC_FACTOR + MAX_GEODESIC_BIAS;
        if (gd !== null && gd <= maxGeodesic) {
          chosen = { x: cx, y: cy };
          break;
        }
        if (farChosen === null) {
          farChosen = { x: cx, y: cy };
        }
      } else {
        chosen = { x: cx, y: cy };
        break;
      }
    }

    const slot = chosen ??
      farChosen ??
      fallback ?? {
        x: Math.min(Math.max(0.5, centerX), terrain.width - 0.5),
        y: Math.min(Math.max(0.5, centerY), terrain.height - 0.5),
      };
    markFootprintCells(usedCells, terrain.width, terrain.height, slot.x, slot.y, m.tier);
    result.set(m.handle, slot);
  }

  return result;
}

const SURROUND_ARC_FAN: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.9612616959383189, 0.27563735581699916],
  [0.9612616959383189, -0.27563735581699916],
  [0.848048096156426, 0.5299192642332049],
  [0.848048096156426, -0.5299192642332049],
  [0.6691306063588582, 0.7431448254773942],
  [0.6691306063588582, -0.7431448254773942],
  [0.4383711467890774, 0.898794046299167],
  [0.4383711467890774, -0.898794046299167],
  [0.17364817766693033, 0.984807753012208],
  [0.17364817766693033, -0.984807753012208],
  [-0.10452846326765346, 0.9945218953682733],
  [-0.10452846326765346, -0.9945218953682733],
  [-0.374606593415912, 0.9271838545667874],
  [-0.374606593415912, -0.9271838545667874],
];

// Project engaging non-shooting members onto a curved firing arc around a
// hostile at (hx, hy) outside already-occupied front-rank cells, then uncross
// same-tier pairs via 2-opt so flanks glide smoothly to the nearest wing.
export function projectSurroundArcSlots(
  terrain: TerrainApi,
  pathing: PathingApi | null,
  goalId: number | null,
  hx: number,
  hy: number,
  centroidX: number,
  centroidY: number,
  members: readonly FormationMemberInfo[],
  offsets: ReadonlyMap<number, { fwd: number; right: number }>,
  reservedCells?: ReadonlySet<number>,
): Map<number, { x: number; y: number }> {
  if (members.length === 0) {
    return new Map();
  }
  const dx = centroidX - hx;
  const dy = centroidY - hy;
  const d = Math.sqrt(dx * dx + dy * dy);
  const ux = d > 1e-6 ? dx / d : -1;
  const uy = d > 1e-6 ? dy / d : 0;
  const rx = -uy;
  const ry = ux;

  const ordered = sortFormationMembers(members);
  const usedCells = new Set<number>(reservedCells);
  const checkNear = goalId !== null && pathing !== null;
  const fallbackMap = projectFormationSlots(
    terrain,
    pathing,
    goalId,
    hx,
    hy,
    -ux,
    -uy,
    ordered,
    offsets,
    reservedCells,
  );
  const slots: { x: number; y: number }[] = [];

  for (const m of ordered) {
    const rBase = m.range <= 1.2 ? 0.85 : Math.max(1.6, m.range - 0.35);
    const radii =
      m.range <= 1.2
        ? [0.85, 1.45, 2.1, 2.8]
        : [rBase, Math.max(1.4, rBase - 0.9), rBase + 0.9, Math.max(1.4, rBase - 1.8), rBase + 1.8];
    let picked: { x: number; y: number } | null = null;
    for (const rad of radii) {
      if (picked !== null) {
        break;
      }
      for (const [cAng, sAng] of SURROUND_ARC_FAN) {
        const wx = hx + rad * (ux * cAng + rx * sAng);
        const wy = hy + rad * (uy * cAng + ry * sAng);
        const ax = clearanceAnchorCell(wx, m.tier);
        const ay = clearanceAnchorCell(wy, m.tier);
        if (!terrain.inBounds(ax, ay) || !terrain.passable(ax, ay, m.cls, m.tier)) {
          continue;
        }
        if (checkNear && pathing.directionAt(goalId, ax, ay) === null) {
          continue;
        }
        const cx = clearanceAnchorCenter(ax, m.tier);
        const cy = clearanceAnchorCenter(ay, m.tier);
        if (!isFootprintFree(usedCells, terrain.width, cx, cy, m.tier)) {
          continue;
        }
        if (checkNear) {
          const gd = pathing.distanceAt(goalId, cx, cy);
          const euclidSq = (cx - hx) * (cx - hx) + (cy - hy) * (cy - hy);
          if (gd !== null && gd <= Math.sqrt(euclidSq) * 2.5 + 3.0) {
            picked = { x: cx, y: cy };
            break;
          }
        } else {
          picked = { x: cx, y: cy };
          break;
        }
      }
    }
    const chosen = picked ?? fallbackMap.get(m.handle) ?? { x: hx, y: hy };
    markFootprintCells(usedCells, terrain.width, terrain.height, chosen.x, chosen.y, m.tier);
    slots.push(chosen);
  }

  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < ordered.length; i++) {
      const mi = ordered[i];
      const si = slots[i];
      if (mi === undefined || si === undefined) {
        continue;
      }
      for (let j = i + 1; j < ordered.length; j++) {
        const mj = ordered[j];
        const sj = slots[j];
        if (
          mj === undefined ||
          sj === undefined ||
          mi.tier !== mj.tier ||
          mi.cls !== mj.cls ||
          Math.abs(mi.range - mj.range) > 1.5
        ) {
          continue;
        }
        const curCost =
          (si.x - mi.x) * (si.x - mi.x) +
          (si.y - mi.y) * (si.y - mi.y) +
          (sj.x - mj.x) * (sj.x - mj.x) +
          (sj.y - mj.y) * (sj.y - mj.y);
        const altCost =
          (sj.x - mi.x) * (sj.x - mi.x) +
          (sj.y - mi.y) * (sj.y - mi.y) +
          (si.x - mj.x) * (si.x - mj.x) +
          (si.y - mj.y) * (si.y - mj.y);
        if (altCost + 1e-6 < curCost) {
          slots[i] = sj;
          slots[j] = si;
          swapped = true;
        }
      }
    }
  }

  const result = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    const s = slots[i];
    if (m !== undefined && s !== undefined) {
      result.set(m.handle, s);
    }
  }
  return result;
}

export interface GeodesicSample {
  handle: number;
  dist: number;
  fwd: number;
  speed: number;
}

export interface GeodesicPacing {
  sRef: number;
  vCruise: number;
  vMax: number;
  sMed: number;
}

// Compute outlier-proof 1D geodesic station reference and target cruise speed
// from Eikonal remaining distances `d_i` and role depth offsets `fwd_i`
// (s_i = d_i + fwd_i). Rejects strays > strayDist from the median and trims
// 20% tails on >= 5 valid samples (ADR 0057).
export function computeGeodesicPacing(
  samples: readonly GeodesicSample[],
  strayDist: number,
): GeodesicPacing | null {
  if (samples.length === 0) {
    return null;
  }
  let vMax = 0;
  const entries: { handle: number; station: number; speed: number }[] = [];
  for (const s of samples) {
    if (s.speed > vMax) {
      vMax = s.speed;
    }
    entries.push({ handle: s.handle, station: s.dist + s.fwd, speed: s.speed });
  }
  if (vMax <= 0) {
    return null;
  }
  entries.sort((a, b) => a.station - b.station || a.handle - b.handle);
  const n = entries.length;
  const mid = n >> 1;
  const sMed =
    n % 2 === 1
      ? (entries[mid]?.station ?? 0)
      : ((entries[mid - 1]?.station ?? 0) + (entries[mid]?.station ?? 0)) * 0.5;

  const filtered = entries.filter((e) => Math.abs(e.station - sMed) <= strayDist);
  const inBand = filtered.length > 0 ? filtered : entries;

  const trim = inBand.length >= 5 ? Math.floor(inBand.length * 0.2) : 0;
  const start = trim;
  const end = inBand.length - trim;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += inBand[i]?.station ?? 0;
  }
  const sRef = sum / Math.max(1, end - start);

  let vSlow = Infinity;
  for (const e of inBand) {
    if (e.speed > 0 && e.speed < vSlow) {
      vSlow = e.speed;
    }
  }
  if (!Number.isFinite(vSlow)) {
    vSlow = vMax;
  }
  return {
    sRef,
    vCruise: Math.max(vSlow, vMax * 0.5),
    vMax,
    sMed,
  };
}

// Compute scalar cruise speed cap for a squad member during transit; returns 0
// when uncapped (null distance, stray outlier, lagging behind sRef, or already
// aligned within vCruise).
export function computeGeodesicCruiseCap(
  memberSpeed: number,
  memberDist: number | null,
  fwd: number,
  pacing: GeodesicPacing,
  strayDist: number,
): number {
  if (memberDist === null || memberSpeed <= 0) {
    return 0;
  }
  const station = memberDist + fwd;
  if (Math.abs(station - pacing.sMed) > strayDist) {
    return 0;
  }
  const ahead = pacing.sRef - station;
  if (ahead < -0.75) {
    return 0;
  }
  if (memberSpeed > pacing.vCruise * 1.02 || ahead > 0.65) {
    const base = Math.min(memberSpeed, pacing.vCruise);
    const scale = ahead > 0.65 ? Math.max(0.55, 1 - (ahead - 0.65) * 0.15) : 1;
    const cap = base * scale;
    return cap < memberSpeed * 0.985 ? cap : 0;
  }
  return 0;
}
