// Road-tool helpers (M3 E3): the click-one-click-two route selection and
// cursor hover picking over the logistics network channel. Links are
// indexed into the channel's links arrays; a/b are node indices into the
// nodes arrays. Pure so the extension rules are unit-testable.
import type { ContentDb } from '../../../content/index';
import type { Snapshot } from '../../../core/index';
import { StructuresChannel, type ConstructionStructures } from '../../construction/protocol';
import { LogisticsNetworkChannel, type LogisticsNetwork, type RoadLinkKey } from '../protocol';
import { linkFlow } from '../render/link-flow';

export type { RoadLinkKey };

export interface RoadLinkInfo {
  a: number;
  b: number;
  // Smoothed carried flow (volOut + volIn), whatever unit the caller
  // smooths in — only relative comparisons are used.
  flow: number;
}

// Extends a clicked link into a route: from each endpoint greedily pick
// the incident unselected link with the highest flow (ties by link
// index), continuing while the candidate flow is >= half the clicked
// link's flow and the far node is neither a warehouse nor a leaf.
export function extendRoute(
  links: readonly RoadLinkInfo[],
  clicked: number,
  warehouseNodes: ReadonlySet<number>,
): number[] {
  const sel = new Set<number>([clicked]);
  const base = links[clicked];
  if (base === undefined) {
    return [];
  }
  const degree = new Map<number, number>();
  const incident = new Map<number, number[]>();
  links.forEach((link, i) => {
    for (const n of [link.a, link.b]) {
      degree.set(n, (degree.get(n) ?? 0) + 1);
      const list = incident.get(n);
      if (list === undefined) {
        incident.set(n, [i]);
      } else {
        list.push(i);
      }
    }
  });
  const threshold = base.flow / 2;
  // Never extend from an endpoint that is a warehouse or a leaf; nodes on
  // the route are tracked so the greedy walk cannot loop around a mesh
  // cycle.
  const visited = new Set<number>([base.a, base.b]);
  const frontier: number[] = [];
  for (const n of [base.a, base.b]) {
    if (!warehouseNodes.has(n) && (degree.get(n) ?? 0) > 1) {
      frontier.push(n);
    }
  }
  while (frontier.length > 0) {
    const node = frontier.shift() ?? 0;
    let best = -1;
    let bestFlow = -Infinity;
    for (const i of incident.get(node) ?? []) {
      const flow = links[i]?.flow ?? -Infinity;
      const far = links[i] === undefined ? -1 : links[i].a === node ? links[i].b : links[i].a;
      if (!sel.has(i) && !visited.has(far) && flow > bestFlow) {
        best = i;
        bestFlow = flow;
      }
    }
    const chosen = best === -1 ? undefined : links[best];
    if (chosen === undefined || chosen.flow < threshold) {
      continue;
    }
    sel.add(best);
    const next = chosen.a === node ? chosen.b : chosen.a;
    visited.add(next);
    if (!warehouseNodes.has(next) && (degree.get(next) ?? 0) > 1) {
      frontier.push(next);
    }
  }
  return [...sel].sort((x, y) => x - y);
}

// Squared distance from (x, y) to the segment (ax, ay)-(bx, by).
function segDist2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return px * px + py * py;
}

// Distance from (x, y) to a polyline of cell indices (cell centres).
function polylineDist2(
  x: number,
  y: number,
  cells: ArrayLike<number>,
  from: number,
  to: number,
  width: number,
): number {
  let best = Infinity;
  let px = -1;
  let py = -1;
  for (let i = from; i < to; i++) {
    const cell = cells[i] ?? 0;
    const cx = (cell % width) + 0.5;
    const cy = Math.floor(cell / width) + 0.5;
    if (px >= 0) {
      best = Math.min(best, segDist2(x, y, px, py, cx, cy));
    }
    px = cx;
    py = cy;
    if (best === Infinity) {
      best = segDist2(x, y, cx, cy, cx, cy);
    }
  }
  return best;
}

// Nearest link whose polyline is within maxDist cells of (x, y);
// ties resolve by link index. Returns -1 when nothing is near.
export function nearestLink(
  links: {
    pathOffsets: ArrayLike<number>;
    pathCells: ArrayLike<number>;
    a: ArrayLike<number>;
  },
  width: number,
  x: number,
  y: number,
  maxDist = 0.75,
): number {
  let best = -1;
  let bestDist2 = maxDist * maxDist;
  for (let i = 0; i < links.a.length; i++) {
    const d = polylineDist2(
      x,
      y,
      links.pathCells,
      links.pathOffsets[i] ?? 0,
      links.pathOffsets[i + 1] ?? 0,
      width,
    );
    if (d < bestDist2) {
      bestDist2 = d;
      best = i;
    }
  }
  return best;
}

interface KeyedNetwork {
  nodes: { handles: ArrayLike<number> };
  links: { a: ArrayLike<number>; b: ArrayLike<number> };
}

// Node-handle pair of link `index` (smaller handle first), or null when
// either endpoint handle is unset.
export function linkKey(network: KeyedNetwork, index: number): RoadLinkKey | null {
  const a = network.nodes.handles[network.links.a[index] ?? 0] ?? 0;
  const b = network.nodes.handles[network.links.b[index] ?? 0] ?? 0;
  if (a === 0 || b === 0) {
    return null;
  }
  return a < b ? { a, b } : { a: b, b: a };
}

export function sameKey(key: RoadLinkKey, a: number, b: number): boolean {
  return (key.a === a && key.b === b) || (key.a === b && key.b === a);
}

// Resolves stored handle pairs to current link indices, dropping keys
// whose link no longer exists.
export function linkIndices(network: KeyedNetwork, keys: readonly RoadLinkKey[]): number[] {
  const index = new Map<string, number>();
  for (let i = 0; i < network.links.a.length; i++) {
    const key = linkKey(network, i);
    if (key !== null) {
      index.set(`${key.a}:${key.b}`, i);
    }
  }
  const out: number[] = [];
  for (const key of keys) {
    const i = index.get(`${key.a}:${key.b}`);
    if (i !== undefined) {
      out.push(i);
    }
  }
  return out;
}

// Extends a clicked link into a route over the current snapshot, using
// smoothed link flow and stopping at warehouse or leaf nodes, then maps
// the selected link indices back to stable handle-pair keys.
export function extendRoadSelection(
  db: ContentDb,
  snapshot: Snapshot | null,
  clickedLink: number,
): RoadLinkKey[] {
  if (snapshot === null) {
    return [];
  }
  const net = snapshot.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined;
  if (net === undefined || clickedLink < 0 || clickedLink >= net.links.a.length) {
    return [];
  }
  const structures = snapshot.channels[StructuresChannel.id] as ConstructionStructures | undefined;
  const warehouses = new Set<number>();
  if (structures !== undefined) {
    for (let i = 0; i < structures.handles.length; i++) {
      const kind = db.structures.byIndex(structures.kind[i] ?? 0);
      if (kind?.node?.warehouse === true) {
        warehouses.add(structures.handles[i] ?? 0);
      }
    }
  }
  const warehouseNodes = new Set<number>();
  for (let i = 0; i < net.nodes.handles.length; i++) {
    if (warehouses.has(net.nodes.handles[i] ?? 0)) {
      warehouseNodes.add(i);
    }
  }
  const vol = linkFlow(snapshot, net).vol;
  const links: RoadLinkInfo[] = [];
  for (let i = 0; i < net.links.a.length; i++) {
    links.push({
      a: net.links.a[i] ?? 0,
      b: net.links.b[i] ?? 0,
      flow: vol[i] ?? 0,
    });
  }
  const route = extendRoute(links, clickedLink, warehouseNodes);
  const selected = route.includes(clickedLink) ? route : [clickedLink];
  return selected.map((i) => linkKey(net, i)).filter((k): k is RoadLinkKey => k !== null);
}
