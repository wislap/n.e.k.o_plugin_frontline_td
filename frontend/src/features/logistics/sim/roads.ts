// Roads (m3 E1): the global per-cell road-level layer, the public pave
// API (module-state array mirrored into the layer like terrain's blocked
// overlay), the lazy per-link multiplier refresh and the upgrade query
// used by construction. Roads only change link multipliers — routing and
// connectivity always stay on terrain step costs.
import type { EntityHandle, EntityId, FactionId, Serializable } from '../../../core/index';
import { handleGeneration, handleId } from '../../../core/index';
import { defineGridLayer } from '../../../kernel/index';
import type { SystemContext } from '../../../kernel/index';
import { UNREACHABLE } from '../../pathing/sim/index';
import { ROAD_LAYER_ID } from '../protocol';
import { fullTree } from './alloc';
import type { LogisticsEnv } from './env';
import type { FactionTopo } from './topology';
import { linkMultiplier } from './topology';

export const RoadLayer = defineGridLayer(ROAD_LAYER_ID, 'u8', { perFaction: false });

// Raise the level of the given cells; never lowers. Mirrors into the
// layer at the next capture_fog tick (the layer itself is serialized,
// so the array and the layer can never diverge across a save).
export function paveRoads(
  env: LogisticsEnv,
  cells: readonly { x: number; y: number }[],
  level: number,
) {
  const w = env.terrain.width;
  let changed = false;
  for (const c of cells) {
    if (!env.terrain.inBounds(c.x, c.y)) {
      continue;
    }
    const i = c.y * w + c.x;
    if ((env.roads[i] ?? 0) < level) {
      env.roads[i] = level;
      changed = true;
    }
  }
  if (changed) {
    env.roadVersion += 1;
    env.roadDirty = true;
  }
}

// Recompute each link's effective multiplier when the road version (or
// the topology itself) changed since the topo was built.
export function refreshMultipliers(env: LogisticsEnv, topo: FactionTopo): void {
  if (topo.roadV === env.roadVersion) {
    return;
  }
  for (const l of topo.links) {
    l.m = linkMultiplier(l, env.roads, env.roadMult);
  }
  topo.roadV = env.roadVersion;
}

export function mirrorRoads(env: LogisticsEnv, ctx: SystemContext): void {
  if (env.roadDirty) {
    env.roadDirty = false;
    ctx.writeLayer(env.roadW).set(env.roads);
  }
}

// The upgrade query for construction: the link polyline oriented
// upstream (warehouse side per the budget-free full tree) -> downstream,
// per-cell cumulative path cost, the upstream node's handle and the link
// index. Null when the handles do not resolve to linked own nodes.
export interface LinkPath {
  link: number;
  cells: number[];
  // cum[k] = path cost from the upstream ring to cells[k] (cum[0] = 0).
  cum: number[];
  // Current road level per cell (parallel to cells).
  roads: number[];
  upstream: number;
  // Endpoint node entity ids (link.a / link.b) for dedupe.
  nodeA: number;
  nodeB: number;
}

export function linkPath(
  env: LogisticsEnv,
  ctx: SystemContext,
  faction: FactionId,
  a: number,
  b: number,
): LinkPath | null {
  const topo = env.topos.get(faction);
  if (topo === undefined) {
    return null;
  }
  const idA = ctx.resolve(a as EntityHandle);
  const idB = ctx.resolve(b as EntityHandle);
  if (idA === null || idB === null) {
    return null;
  }
  const idxA = topo.nodes.findIndex((n) => n.id === idA);
  const idxB = topo.nodes.findIndex((n) => n.id === idB);
  const li = topo.links.findIndex(
    (l) => (l.a === idxA && l.b === idxB) || (l.a === idxB && l.b === idxA),
  );
  const link = topo.links[li];
  if (idxA < 0 || idxB < 0 || link === undefined) {
    return null;
  }
  // Upstream = the end nearer the warehouse on the full tree; distance
  // ties (and a missing warehouse) resolve to link.a.
  const full = fullTree(topo);
  const dA = full.dist[link.a] ?? UNREACHABLE;
  const dB = full.dist[link.b] ?? UNREACHABLE;
  const upstreamIdx = dA <= dB ? link.a : link.b;
  const forward = upstreamIdx === link.a;
  const cells = forward ? [...link.cells] : [...link.cells].reverse();
  const cum: number[] = new Array<number>(cells.length).fill(0);
  for (let k = 1; k < cells.length; k++) {
    // Reversed traversal walks the same edges; the step of edge j is
    // steps[len - j] in the forward array.
    const step = forward ? (link.steps[k] ?? 0) : (link.steps[cells.length - k] ?? 0);
    cum[k] = (cum[k - 1] ?? 0) + step;
  }
  const upstream = ctx.handleOf(topo.nodes[upstreamIdx]?.id as EntityId);
  if (upstream === null) {
    return null;
  }
  return {
    link: li,
    cells,
    cum,
    roads: cells.map((c) => env.roads[c] ?? 0),
    upstream: Number(upstream),
    nodeA: topo.nodes[link.a]?.id ?? 0,
    nodeB: topo.nodes[link.b]?.id ?? 0,
  };
}

// Decoded FixedAttach target for parts factories and attachOf.
export function fixedAttachInit(handle: number, lastMile: number): Record<string, number> {
  const h = handle as EntityHandle;
  return { node: handleId(h), gen: handleGeneration(h), lastMile };
}

export function saveRoads(env: LogisticsEnv): Serializable {
  return { data: [...env.roads], v: env.roadVersion };
}

export function loadRoads(env: LogisticsEnv, data: Serializable): void {
  const raw = data as unknown as { data: number[]; v: number };
  env.roads.set(raw.data);
  env.roadVersion = raw.v;
  env.roadDirty = true;
}
