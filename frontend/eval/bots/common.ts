// Shared bot kit (M4 D): snapshot readers, nearest-pick, and structure
// placement through the shared placement rules over the snapshot adapter
// (features/construction/rules/placement-view.ts). Bots are controllers:
// commands only, own snapshot only, all mutable state inside save/load.
import type { ContentDb, ResolvedMap, ResolvedStructure } from '../../src/content/index';
import type { FactionId, Snapshot } from '../../src/core/index';
import type { PlacementRule, PlacementView } from '../../src/features/construction/rules/index';
import {
  checkFootprint,
  checkRange,
  makePlacementView,
} from '../../src/features/construction/rules/index';
import { PlaceCommand } from '../../src/features/construction/protocol';
import {
  StructuresChannel,
  type ConstructionStructures,
} from '../../src/features/construction/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../../src/features/units/protocol';
import { VisionMemoryChannel, type VisionMemory } from '../../src/features/vision/protocol';
import {
  LogisticsNetworkChannel,
  type LogisticsNetwork,
} from '../../src/features/logistics/protocol';
import {
  SquadsChannel,
  SquadsCreate,
  SquadsOrder,
  type SquadsSnapshot,
  type SquadView,
} from '../../src/features/squads/protocol';

export const DECIDE_PERIOD = 20;

export interface BotOptions {
  faction: FactionId;
  db: ContentDb;
  map: ResolvedMap;
  hostile: ReadonlySet<number>;
}

interface UnitRow {
  handle: number;
  kind: number;
  x: number;
  y: number;
}

function ownUnits(snapshot: Snapshot, faction: FactionId): UnitRow[] {
  const dense = snapshot.channels[DenseUnitsChannel.id] as DenseUnits | undefined;
  const out: UnitRow[] = [];
  if (dense === undefined) {
    return out;
  }
  for (let i = 0; i < dense.handles.length; i++) {
    if (dense.faction[i] !== Number(faction)) {
      continue;
    }
    out.push({
      handle: dense.handles[i] ?? 0,
      kind: dense.kind[i] ?? 0,
      x: dense.x[i] ?? 0,
      y: dense.y[i] ?? 0,
    });
  }
  return out;
}

export interface StructureRow {
  handle: number;
  kind: number;
  // Footprint centre.
  x: number;
  y: number;
  state: number;
}

export function structures(
  snapshot: Snapshot,
  db: ContentDb,
  filter: (faction: number) => boolean,
): StructureRow[] {
  const st = snapshot.channels[StructuresChannel.id] as ConstructionStructures | undefined;
  const out: StructureRow[] = [];
  if (st !== undefined) {
    for (let i = 0; i < st.handles.length; i++) {
      if (!filter(st.faction[i] ?? 0)) {
        continue;
      }
      const def = db.structures.byIndex(st.kind[i] ?? 0);
      out.push({
        handle: st.handles[i] ?? 0,
        kind: st.kind[i] ?? 0,
        x: (st.x[i] ?? 0) + (def?.footprint.w ?? 1) / 2,
        y: (st.y[i] ?? 0) + (def?.footprint.h ?? 1) / 2,
        state: st.state[i] ?? 0,
      });
    }
  }
  // Fog memory (M5): remembered non-own structures not currently
  // visible — bots under fog still find the hive/outposts through it.
  const mem = snapshot.channels[VisionMemoryChannel.id] as VisionMemory | undefined;
  if (mem !== undefined) {
    for (let i = 0; i < mem.handles.length; i++) {
      if (!filter(mem.faction[i] ?? 0)) {
        continue;
      }
      const def = db.structures.byIndex(mem.kind[i] ?? 0);
      out.push({
        handle: mem.handles[i] ?? 0,
        kind: mem.kind[i] ?? 0,
        x: (mem.x[i] ?? 0) + (def?.footprint.w ?? 1) / 2,
        y: (mem.y[i] ?? 0) + (def?.footprint.h ?? 1) / 2,
        state: mem.state[i] ?? 0,
      });
    }
  }
  return out;
}

export function ownSquads(snapshot: Snapshot, faction: FactionId): SquadView[] {
  const snap = snapshot.channels[SquadsChannel.id] as SquadsSnapshot | undefined;
  return (snap?.squads ?? []).filter((s) => s.faction === Number(faction));
}

// Own unit handles not in any own squad — candidates for a new squad.
export function unsquadded(
  snapshot: Snapshot,
  faction: FactionId,
  squads: readonly SquadView[],
): number[] {
  const assigned = new Set<number>();
  for (const s of squads) {
    for (const h of s.members ?? []) {
      assigned.add(h);
    }
  }
  return ownUnits(snapshot, faction)
    .map((u) => u.handle)
    .filter((h) => !assigned.has(h));
}

export function nearest<T extends { x: number; y: number; handle: number }>(
  from: { x: number; y: number },
  list: readonly T[],
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best !== null && e.handle < best.handle)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// Warehouse stock in whole units for one cargo index (0 without a net).
export function stockOf(snapshot: Snapshot, cargoIndex: number): number {
  const net = snapshot.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined;
  return Math.floor((net?.stock[cargoIndex] ?? 0) / 1000);
}

// The placement rule for a structure kind, mirroring sim/env.placementRule
// (kept duplicated: that helper is sim-internal and eval must not reach
// into sim/ — it's four fields).
function ruleOf(kind: ResolvedStructure): PlacementRule {
  return {
    w: kind.footprint.w,
    h: kind.footprint.h,
    node: kind.node !== undefined,
    connect: kind.node?.connect ?? 0,
    requiresDeposit: kind.requiresDeposit ?? -1,
  };
}

// Deterministic ring scan around `near` (ascending Chebyshev radius,
// y-then-x order): first cell where footprint and range checks pass.
function findPlacement(
  view: PlacementView,
  rule: PlacementRule,
  near: { x: number; y: number },
  maxRadius: number,
): { x: number; y: number } | null {
  const cx = Math.floor(near.x - rule.w / 2);
  const cy = Math.floor(near.y - rule.h / 2);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
          continue;
        }
        const x = cx + dx;
        const y = cy + dy;
        if (checkFootprint(rule, x, y, view) === 'ok' && checkRange(rule, x, y, view) === 'ok') {
          return { x, y };
        }
      }
    }
  }
  return null;
}

export interface Issue {
  (type: string, payload: unknown): void;
}

// Tries to place `kindId` near `near`; issues the command on success.
// blueprint=false so sites start building on their own.
export function tryBuild(
  issue: Issue,
  db: ContentDb,
  map: ResolvedMap,
  snapshot: Snapshot,
  faction: FactionId,
  kindId: string,
  near: { x: number; y: number },
  maxRadius: number = 10,
): boolean {
  const kind = db.structures.byId(kindId);
  if (kind === undefined || kind.build === undefined) {
    return false;
  }
  const view = makePlacementView(db, map, snapshot, Number(faction));
  const cell = findPlacement(view, ruleOf(kind), near, maxRadius);
  if (cell === null) {
    return false;
  }
  issue(PlaceCommand.type, { kind: kindId, x: cell.x, y: cell.y, blueprint: false });
  return true;
}

export function hasStructure(
  snapshot: Snapshot,
  db: ContentDb,
  faction: FactionId,
  kindId: string,
): boolean {
  const idx = db.structures.byId(kindId)?.index ?? -1;
  return structures(snapshot, db, (f) => f === Number(faction)).some((s) => s.kind === idx);
}

// Creates a tagged squad from the first `size` unsquadded units.
export function formSquad(issue: Issue, units: readonly number[], size: number, tag: string): void {
  if (units.length < size) {
    return;
  }
  issue(SquadsCreate.type, { units: units.slice(0, size), tag });
}

export function orderSquad(
  issue: Issue,
  squad: SquadView,
  kind: 'guard' | 'advance',
  x: number,
  y: number,
  radius?: number,
): void {
  issue(SquadsOrder.type, {
    squad: squad.id,
    kind,
    x: Math.floor(x),
    y: Math.floor(y),
    ...(radius !== undefined ? { radius } : {}),
  });
}

export type { SquadView };
