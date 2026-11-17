// Topology derivation helpers: collect the operational node set, rebuild
// a faction's topology, and attach a store entity to its nearest node.
import type { EntityId, FactionId } from '../../../core/index';
import { packHandle } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction, InWorld, OPERATIONAL_EXCLUDE } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { FixedAttach, LogisticsNode, SiteStore } from './components';
import type { Attach, LogisticsEnv } from './env';
import { buildFactionTopo, ringCells, ringDistances } from './topology';
import type { FactionTopo, TopoNode } from './topology';

export function collectNodeIds(ctx: SystemContext, faction: number): number[] {
  const fac = ctx.read(Faction);
  const ids = ctx.query([LogisticsNode, Position, Faction, InWorld], OPERATIONAL_EXCLUDE);
  const out: number[] = [];
  for (const id of ids) {
    if ((fac.id[id] ?? 0) === faction) {
      out.push(id);
    }
  }
  return out;
}

// Read TopoNode data for the given node entity ids.
export function nodeListOf(ctx: SystemContext, ids: readonly number[]): TopoNode[] {
  const node = ctx.read(LogisticsNode);
  const pos = ctx.read(Position);
  return ids.map((id) => ({
    id,
    x: pos.x[id] ?? 0,
    y: pos.y[id] ?? 0,
    connect: node.connect[id] ?? 0,
    service: node.service[id] ?? 0,
    vehicles: node.vehicles[id] ?? 0,
    warehouse: (node.warehouse[id] ?? 0) === 1,
    w: node.w[id] ?? 0,
    h: node.h[id] ?? 0,
  }));
}

export function rebuildTopo(
  env: LogisticsEnv,
  ctx: SystemContext,
  faction: number,
  ids: number[],
): void {
  const nodes = nodeListOf(ctx, ids);
  const topo = buildFactionTopo(
    nodes,
    env.terrain,
    env.groundCls,
    env.roads,
    env.roadMult,
    env.roadVersion,
  );
  env.topos.set(faction, topo);
  env.topoNodeIds.set(faction, ids);
  ctx.writeLayer(env.layerW, faction as FactionId).set(topo.covered);
}

// The best completed node a hypothetical site `site` would link to:
// same ring-distance rule as buildFactionTopo links — a candidate n
// links when site->n ring distance <= min(site.connect, n.connect);
// ties break on node id (deterministic). Used by site attachment and by
// the construction connectivity query.
export function bestSiteLink(
  nodes: readonly TopoNode[],
  site: TopoNode,
  terrain: TerrainApi,
  cls: number,
): { index: number; cost: number } | null {
  const dist = ringDistances(site, terrain, cls, site.connect);
  if (dist === null) {
    return null;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as TopoNode;
    const bound = Math.min(site.connect, n.connect);
    for (const c of ringCells(n, terrain, cls)) {
      const d = dist[c] ?? Infinity;
      if (d <= bound && (d < bestD || (d === bestD && n.id < (nodes[best]?.id ?? 0)))) {
        bestD = d;
        best = i;
      }
    }
  }
  if (best < 0) {
    return null;
  }
  return { index: best, cost: Math.floor(bestD) };
}

// Attachment for a demand entity: node index + last-mile cost, or null
// when the entity is not covered.
export function attachOf(
  env: LogisticsEnv,
  ctx: SystemContext,
  topo: FactionTopo,
  id: number,
  px: number,
  py: number,
): Attach | null {
  if (ctx.has(FixedAttach, id as EntityId)) {
    // Pinned attachment (road segments): the stored node must still be
    // alive with the same generation and still be a topo node.
    const fa = ctx.read(FixedAttach);
    const target = ctx.resolve(packHandle(fa.node[id] ?? 0, fa.gen[id] ?? 0));
    if (target === null) {
      return null;
    }
    const idx = topo.nodes.findIndex((n) => n.id === target);
    return idx < 0 ? null : { node: idx, lastMile: fa.lastMile[id] ?? 0 };
  }
  const selfIdx = topo.nodes.findIndex((n) => n.id === id);
  if (selfIdx >= 0) {
    // Self-attachment: an operational node entity attaches to itself.
    return { node: selfIdx, lastMile: 0 };
  }
  if (ctx.has(SiteStore, id as EntityId) && ctx.has(LogisticsNode, id as EntityId)) {
    // Site nodes attach to the best completed node that would link to
    // them; the last mile is that link's path cost.
    const node = ctx.read(LogisticsNode);
    const site: TopoNode = {
      id,
      x: px,
      y: py,
      connect: node.connect[id] ?? 0,
      service: node.service[id] ?? 0,
      vehicles: 0,
      warehouse: false,
      w: node.w[id] ?? 0,
      h: node.h[id] ?? 0,
    };
    const link = bestSiteLink(topo.nodes, site, env.terrain, env.groundCls);
    if (link === null) {
      return null;
    }
    return { node: link.index, lastMile: link.cost };
  }
  const cell = Math.floor(py) * env.terrain.width + Math.floor(px);
  const n = topo.attach[cell] ?? -1;
  if (n < 0) {
    return null;
  }
  return { node: n, lastMile: topo.attachCost[cell] ?? 0 };
}
