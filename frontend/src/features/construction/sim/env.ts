// Shared construction module state: the injected dependencies, component
// writers and the serialized per-faction blueprint reservation map
// (cell -> blueprint entity id + 1, so 0 can mean "no reservation").
import type { ContentDb, ResolvedStructure } from '../../../content/index';
import type { FactionId, Serializable } from '../../../core/index';
import type { ComponentWriter, SpawnInit, SystemContext } from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import type { RoadSegmentDesc } from '../protocol';
import type { PlacementRule, PlacementView } from '../rules/index';

// Injected structure spawn-part factories (logistics contributes node +
// store parts; later batches add theirs).
export type StructurePartsFn = (
  kind: ResolvedStructure,
  x: number,
  y: number,
  phase: 'site' | 'complete',
  tick: number,
) => SpawnInit;

// Injected road-segment spawn parts (logistics site slots + FixedAttach,
// combat Health + Targetable); same pattern as structureParts.
export type RoadSegmentPartsFn = (desc: RoadSegmentDesc, tick: number) => SpawnInit;

// The upgrade query result logistics hands back (structural mirror of
// its public LinkPath).
interface LinkPathResult {
  link: number;
  cells: number[];
  cum: number[];
  roads: number[];
  upstream: number;
  nodeA: number;
  nodeB: number;
}

// Read-only logistics queries used by placement (no internals import).
export interface LogisticsQueries {
  covered(ctx: SystemContext, faction: FactionId, x: number, y: number): boolean;
  connectsToNetwork(
    ctx: SystemContext,
    faction: FactionId,
    footprint: { x: number; y: number; w: number; h: number },
    connect: number,
  ): boolean;
  // Link polyline between two node handles, upstream -> downstream
  // (null when not linked).
  linkPath(ctx: SystemContext, faction: FactionId, a: number, b: number): LinkPathResult | null;
  // Pave cells at `level` in the road layer (never lowers).
  pave(cells: readonly { x: number; y: number }[], level: number): void;
}

// A serialized road project: pave `cells` in segment order, one live
// segment at a time, from the upstream (warehouse) side.
export interface RoadProject {
  faction: number;
  level: number;
  // Cells left to pave when the order was accepted (upstream -> down).
  cells: number[];
  // Path cost from the upstream node to each cell (parallel to cells).
  cum: number[];
  // Index of the next segment to spawn.
  next: number;
  // Live segment handle (0 while the next segment is pending).
  segment: number;
  // Upstream node handle (FixedAttach target of each segment).
  upstream: number;
  // Endpoint node entity ids (lo < hi) for dedupe.
  a: number;
  b: number;
}

export interface ConstructionEnv {
  db: ContentDb;
  terrain: TerrainApi;
  logistics: LogisticsQueries;
  parts: readonly StructurePartsFn[];
  groundCls: number;
  structureW: ComponentWriter<{ kind: 'u16'; x: 'u16'; y: 'u16' }>;
  constructionW: ComponentWriter<{ progress: 'u32'; total: 'u32'; mode: 'u8' }>;
  blueprintW: ComponentWriter<{
    kind: 'u16';
    x: 'u16';
    y: 'u16';
    activated: 'u8';
    orderTick: 'u32';
  }>;
  ucW: ComponentWriter<Record<string, never>>;
  // faction -> cell -> blueprint entity id + 1.
  reservations: Map<number, Map<number, number>>;
  // Entities whose demolition started this tick. Construction only lands
  // at tick end, so a second cancel in the same tick would otherwise read
  // the building as still finished. Per-tick only: cleared by the
  // command-phase system below and never serialized.
  pendingDemolish: Set<number>;
  // Serialized road projects keyed by a monotonically increasing id
  // (referenced by RoadSegment.project); the counter is serialized with
  // the state and finished projects are deleted so it never grows.
  projects: Map<number, RoadProject>;
  nextProjectId: number;
  segmentParts: readonly RoadSegmentPartsFn[];
}

export function placementRule(kind: ResolvedStructure): PlacementRule {
  return {
    w: kind.footprint.w,
    h: kind.footprint.h,
    node: kind.node !== undefined,
    connect: kind.node?.connect ?? 0,
    requiresDeposit: kind.requiresDeposit ?? -1,
  };
}

// The authoritative placement view: terrain + logistics queries +
// this faction's reservation map. `exceptId` ignores one blueprint's
// own reservation (used when checking whether it can start).
export function placementView(
  env: ConstructionEnv,
  ctx: SystemContext,
  faction: FactionId,
  exceptId = -1,
): PlacementView {
  const terrain = env.terrain;
  const reserved = env.reservations.get(faction);
  return {
    width: terrain.width,
    height: terrain.height,
    passable: (x, y) => terrain.staticPassable(x, y, env.groundCls),
    heightAt: (x, y) => terrain.heightAt(x, y),
    isRamp: (x, y) => terrain.isRamp(x, y),
    blocked: (x, y) => terrain.blocked(x, y),
    reservedByOwn: (x, y) => {
      const v = reserved?.get(y * terrain.width + x) ?? 0;
      return v !== 0 && v !== exceptId + 1;
    },
    covered: (x, y) => env.logistics.covered(ctx, faction, x, y),
    depositAt: (x, y) => terrain.depositAt(x, y),
    connects: (rule, x, y) =>
      env.logistics.connectsToNetwork(ctx, faction, { x, y, w: rule.w, h: rule.h }, rule.connect),
  };
}

export function footprintCells(
  kind: ResolvedStructure,
  x: number,
  y: number,
  visit: (cell: number, cx: number, cy: number) => void,
  width: number,
): void {
  for (let dy = 0; dy < kind.footprint.h; dy++) {
    for (let dx = 0; dx < kind.footprint.w; dx++) {
      visit((y + dy) * width + x + dx, x + dx, y + dy);
    }
  }
}

export function setFootprintBlocked(
  env: ConstructionEnv,
  kind: ResolvedStructure,
  x: number,
  y: number,
  blocked: boolean,
): void {
  const cells: { x: number; y: number }[] = [];
  footprintCells(kind, x, y, (_cell, cx, cy) => cells.push({ x: cx, y: cy }), env.terrain.width);
  env.terrain.setBlocked(cells, blocked);
}

export function freeReservation(
  env: ConstructionEnv,
  faction: FactionId,
  kind: ResolvedStructure,
  x: number,
  y: number,
  blueprintId: number,
): void {
  const map = env.reservations.get(faction);
  if (map === undefined) {
    return;
  }
  footprintCells(
    kind,
    x,
    y,
    (cell) => {
      if (map.get(cell) === blueprintId + 1) {
        map.delete(cell);
      }
    },
    env.terrain.width,
  );
}

// ---- serialized reservation state ------------------------------------

export function saveReservations(env: ConstructionEnv): Serializable {
  const out: Record<string, Record<string, number>> = {};
  for (const [faction, map] of [...env.reservations.entries()].sort((a, b) => a[0] - b[0])) {
    const cells: Record<string, number> = {};
    for (const [cell, id] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
      cells[String(cell)] = id;
    }
    out[String(faction)] = cells;
  }
  return out;
}

export function loadReservations(env: ConstructionEnv, data: Serializable): void {
  env.reservations.clear();
  const record = data as unknown as Record<string, Record<string, number>>;
  for (const [faction, cells] of Object.entries(record)) {
    const map = new Map<number, number>();
    for (const [cell, id] of Object.entries(cells)) {
      map.set(Number(cell), id);
    }
    env.reservations.set(Number(faction), map);
  }
}
