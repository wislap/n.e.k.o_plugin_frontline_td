// Pure allocation math for the logistics cycle (ADR 0025): vehicle-time
// budgets, the T(q) travel cost and qMax(R) inversion, effective-vehicle
// health bands and the budgeted shortest-path trees. All quantities are
// integer cost-units / milli; geometry enters only as last-mile lengths
// that callers pass in already floored.
import { floorDiv } from '../../../core/index';
import { UNREACHABLE, dijkstra } from '../../pathing/sim/index';
import type { FactionTopo } from './topology';

export const INF = 1 << 30;

function assertSafe(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`logistics: ${what} overflow (${n})`);
  }
}

// T(q) = ceil(2·L·q·10000 / (load·m)): the vehicle travel cost of moving
// q milli over length L (cost units) with multiplier m (bp).
// Safety: the numerator product 2·L·q·10000 must stay a safe integer —
// checked explicitly rather than silently wrapping.
export function travelCost(L: number, q: number, load: number, m: number): number {
  if (q <= 0) {
    return 0;
  }
  assertSafe(2 * L * q, 'travel cost numerator');
  assertSafe(2 * L * q * 10000, 'travel cost numerator');
  const den = load * m;
  assertSafe(den, 'travel cost denominator');
  // ceilDiv on safe integers: ceil(a/b) = -floor(-a/b).
  return -floorDiv(-(2 * L * q * 10000), den);
}

// qMax(R): how many milli a remaining budget R can move over length L.
export function qMax(R: number, L: number, load: number, m: number): number {
  if (L <= 0) {
    return INF;
  }
  const den = 2 * L * 10000;
  assertSafe(den, 'qMax denominator');
  assertSafe(R * load, 'qMax numerator');
  assertSafe(R * load * m, 'qMax numerator');
  return floorDiv(R * load * m, den);
}

// effectiveVehicles = vehicles × band factor for the node's health.
export function effectiveVehicles(
  vehicles: number,
  healthBp: number,
  bands: readonly { aboveBp: number; factorBp: number }[],
): number {
  let factor = 10000;
  for (const band of bands) {
    if (healthBp < band.aboveBp) {
      factor = band.factorBp;
      break;
    }
  }
  return floorDiv(vehicles * factor, 10000);
}

// Tree over links where each edge is traversable only when its paying node
// still has budget. For outbound the paying node is the upstream one
// (nearer the warehouse); for inbound it is the far node. Returns the
// distance (edge cost = L·10000/m), parent node and parent link per node.
export interface BudgetTree {
  dist: Int32Array;
  parent: Int32Array;
  parentLink: Int32Array;
  reachable: Uint8Array;
}

export function buildBudgetTree(
  topo: FactionTopo,
  budget: readonly number[],
  inbound: boolean,
): BudgetTree {
  const n = topo.nodes.length;
  const wh = topo.warehouse;
  const dist = new Int32Array(n).fill(UNREACHABLE);
  const parent = new Int32Array(n).fill(-1);
  const parentLink = new Int32Array(n).fill(-1);
  const reachable = new Uint8Array(n);
  if (wh < 0) {
    return { dist, parent, parentLink, reachable };
  }
  // An edge i->j is open when the paying node has remaining budget. The
  // dijkstra callback must therefore respect direction: for outbound the
  // payer is the node we expand from; for inbound the node we expand to.
  const neighbors = (node: number, visit: (to: number, cost: number) => void): void => {
    for (const li of topo.adj[node] ?? []) {
      const link = topo.links[li];
      if (link === undefined) {
        continue;
      }
      const other = link.a === node ? link.b : link.a;
      const payer = inbound ? other : node;
      if ((budget[payer] ?? 0) <= 0) {
        continue;
      }
      const edge = floorDiv(link.cost * 10000, link.m);
      visit(other, edge);
    }
  };
  const d = dijkstra(n, [[wh, 0]], neighbors);
  dist.set(d);
  for (let i = 0; i < n; i++) {
    if (i === wh || dist[i] === undefined || dist[i] === UNREACHABLE) {
      continue;
    }
    // Reconstruct the parent: first neighbour (in adjacency order) that
    // attains dist[i] over an open edge.
    let best: { node: number; link: number } | null = null;
    for (const li of topo.adj[i] ?? []) {
      const link = topo.links[li];
      if (link === undefined) {
        continue;
      }
      const other = link.a === i ? link.b : link.a;
      const payer = inbound ? i : other;
      if ((budget[payer] ?? 0) <= 0) {
        continue;
      }
      const edge = floorDiv(link.cost * 10000, link.m);
      if ((dist[other] ?? UNREACHABLE) + edge !== dist[i]) {
        continue;
      }
      if (best === null || other < best.node || (other === best.node && li < best.link)) {
        best = { node: other, link: li };
      }
    }
    if (best !== null) {
      parent[i] = best.node;
      parentLink[i] = best.link;
      reachable[i] = 1;
    }
  }
  reachable[wh] = 1;
  return { dist, parent, parentLink, reachable };
}

// Links on the tree path from `node` up to the warehouse, paying node per
// link (upstream for outbound, far node for inbound).
export function treePath(
  topo: FactionTopo,
  tree: BudgetTree,
  node: number,
  inbound: boolean,
): { payer: number; link: number }[] | null {
  const out: { payer: number; link: number }[] = [];
  let cur = node;
  while (cur !== topo.warehouse) {
    const p = tree.parent[cur];
    const l = tree.parentLink[cur];
    if (p === undefined || p < 0 || l === undefined || l < 0) {
      return null;
    }
    out.push({ payer: inbound ? cur : p, link: l });
    cur = p;
  }
  return out;
}

// Full-graph shortest tree from the warehouse ignoring budgets (every
// payer treated as funded). Reused for reachability checks, bottleneck
// paths and link-payer direction (the nearer end pays outbound).
export function fullTree(topo: FactionTopo): BudgetTree {
  return buildBudgetTree(
    topo,
    topo.nodes.map(() => 1),
    false,
  );
}

// Bottleneck for an unreachable demand: walk the full-graph path from
// the warehouse outward and report the first payer whose budget is <= 0.
// Returns the node index, or -1 when no payer on the path is exhausted
// (the caller then reports the attached node: the last mile limited it).
export function firstBrokePayer(
  topo: FactionTopo,
  tree: BudgetTree,
  node: number,
  inbound: boolean,
  budgets: readonly number[],
): number {
  const path = treePath(topo, tree, node, inbound);
  if (path === null) {
    return -1;
  }
  // path is attach->warehouse; the first payer in warehouse->out order is
  // the last exhausted one walking up.
  let found = -1;
  for (const { payer } of path) {
    if ((budgets[payer] ?? 0) <= 0) {
      found = payer;
    }
  }
  return found;
}
