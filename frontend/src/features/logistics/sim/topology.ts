// Derived logistics topology (ADR 0025): per-faction node lists, ground
// links between node footprints, the coverage mask and the nearest-node
// attachment array. Everything here is derived state — rebuilt lazily when
// the node set, terrain blockers or a save load make it dirty — so none of
// it is serialized.
import { UNREACHABLE, dijkstra } from '../../pathing/sim/index';
import { DIR_ORDER } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';

export interface TopoNode {
  // Entity id; also the deterministic sort key.
  id: number;
  x: number;
  y: number;
  // Path-cost bound for links (cost units).
  connect: number;
  service: number;
  vehicles: number;
  warehouse: boolean;
  w: number;
  h: number;
}

interface TopoLink {
  // Node indices, a < b.
  a: number;
  b: number;
  // Ground path cost (cost units) — the link length L.
  cost: number;
  // Length-weighted road multiplier in bp; B1 is dirt-only.
  m: number;
  // Path cells from a's ring to b's ring (y * width + x).
  cells: number[];
}

export interface FactionTopo {
  nodes: TopoNode[];
  links: TopoLink[];
  // node index -> link indices.
  adj: number[][];
  // Warehouse node index or -1.
  warehouse: number;
  // cell -> attached node index or -1.
  attach: Int16Array;
  // cell -> last-mile cost of the attached node.
  attachCost: Int32Array;
  // cell -> 1 when covered by some node's service radius.
  covered: Uint8Array;
}

// Passable cells one step outside the footprint, in scan order.
export function ringCells(node: TopoNode, terrain: TerrainApi, cls: number): number[] {
  const x0 = Math.floor(node.x - node.w / 2);
  const y0 = Math.floor(node.y - node.h / 2);
  const cells: number[] = [];
  for (let x = x0 - 1; x <= x0 + node.w; x++) {
    for (const y of [y0 - 1, y0 + node.h]) {
      if (
        x >= 0 &&
        y >= 0 &&
        x < terrain.width &&
        y < terrain.height &&
        terrain.passable(x, y, cls)
      ) {
        cells.push(y * terrain.width + x);
      }
    }
  }
  for (let y = y0; y < y0 + node.h; y++) {
    for (const x of [x0 - 1, x0 + node.w]) {
      if (
        x >= 0 &&
        y >= 0 &&
        x < terrain.width &&
        y < terrain.height &&
        terrain.passable(x, y, cls)
      ) {
        cells.push(y * terrain.width + x);
      }
    }
  }
  return cells;
}

function groundNeighbors(
  terrain: TerrainApi,
  cls: number,
): (node: number, visit: (to: number, cost: number) => void) => void {
  const w = terrain.width;
  return (node, visit) => {
    const x = node % w;
    const y = (node / w) | 0;
    for (const [dx, dy] of DIR_ORDER) {
      const nx = x + dx;
      const ny = y + dy;
      const cost = terrain.stepCost(x, y, nx, ny, cls);
      if (cost >= 0 && nx >= 0 && ny >= 0 && nx < w && ny < terrain.height) {
        visit(ny * w + nx, cost);
      }
    }
  };
}

// Bounded ground Dijkstra seeded from `from`'s ring; returns distances, or
// null when the ring is empty.
export function ringDistances(
  from: TopoNode,
  terrain: TerrainApi,
  cls: number,
  maxCost: number,
): Int32Array | null {
  const ring = ringCells(from, terrain, cls);
  if (ring.length === 0) {
    return null;
  }
  const seeds: [number, number][] = ring.map((c) => [c, 0]);
  return dijkstra(terrain.width * terrain.height, seeds, groundNeighbors(terrain, cls), maxCost);
}

// Greedy descent on the distance field from `start` (a cell of b's ring)
// down to a's seed cells (dist 0). A step is only legal when the neighbour
// is a true predecessor: the dijkstra edge next -> cur must exist and
// attain dist[cur], so the polyline never steps across a cliff or a
// blocked edge. Neighbour order is the fixed DIR_ORDER.
function descentPath(dist: Int32Array, terrain: TerrainApi, cls: number, start: number): number[] {
  const w = terrain.width;
  const cells = [start];
  let cur = start;
  let curD = dist[cur] ?? UNREACHABLE;
  while (curD > 0) {
    const x = cur % w;
    const y = (cur / w) | 0;
    let next = -1;
    let nextD = curD;
    for (const [dx, dy] of DIR_ORDER) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= terrain.height) {
        continue;
      }
      const d = dist[ny * w + nx] ?? UNREACHABLE;
      const step = terrain.stepCost(nx, ny, x, y, cls);
      if (step < 0 || d + step !== curD) {
        continue;
      }
      if (d < nextD) {
        nextD = d;
        next = ny * w + nx;
        if (d === 0) {
          break;
        }
      }
    }
    if (next < 0) {
      break;
    }
    cells.push(next);
    cur = next;
    curD = nextD;
  }
  return cells.reverse();
}

// One bounded dijkstra per node (bound = its own connect), seeded from
// its ring. Node i's distance field then serves every j > i: link i–j
// exists when the best ring-j distance is <= min(connect_i, connect_j).
// Identical to a per-pair bounded search because the tighter pair bound
// only truncates distances that already exceed it.
export function buildFactionTopo(
  nodes: TopoNode[],
  terrain: TerrainApi,
  cls: number,
  roadMultiplierBp: number,
): FactionTopo {
  const size = terrain.width * terrain.height;
  const sorted = [...nodes].sort((x, y) => x.id - y.id);
  const dists = sorted.map((n) => ringDistances(n, terrain, cls, n.connect));
  const rings = sorted.map((n) => ringCells(n, terrain, cls));
  const links: TopoLink[] = [];
  const adj: number[][] = sorted.map(() => []);
  for (let i = 0; i < sorted.length; i++) {
    const dist = dists[i];
    if (dist === null || dist === undefined) {
      continue;
    }
    const a = sorted[i] as TopoNode;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j] as TopoNode;
      const bound = Math.min(a.connect, b.connect);
      let best = -1;
      let bestD = UNREACHABLE;
      for (const c of rings[j] ?? []) {
        const d = dist[c] ?? UNREACHABLE;
        if (d < bestD || (d === bestD && c < best)) {
          bestD = d;
          best = c;
        }
      }
      if (best < 0 || bestD >= UNREACHABLE || bestD > bound) {
        continue;
      }
      const index = links.length;
      links.push({
        a: i,
        b: j,
        cost: bestD,
        m: roadMultiplierBp,
        cells: descentPath(dist, terrain, cls, best),
      });
      adj[i]?.push(index);
      adj[j]?.push(index);
    }
  }

  let warehouse = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]?.warehouse === true) {
      warehouse = i;
      break;
    }
  }

  const attach = new Int16Array(size).fill(-1);
  const attachCost = new Int32Array(size).fill(UNREACHABLE);
  const covered = new Uint8Array(size);
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i] as TopoNode;
    const r = node.service;
    if (r <= 0) {
      continue;
    }
    const cx = Math.floor(node.x);
    const cy = Math.floor(node.y);
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) {
          continue;
        }
        const px = x + 0.5;
        const py = y + 0.5;
        const d = Math.sqrt((px - node.x) * (px - node.x) + (py - node.y) * (py - node.y));
        if (d > r) {
          continue;
        }
        const cell = y * terrain.width + x;
        covered[cell] = 1;
        const last = Math.floor(d * 10);
        const prev = attach[cell] ?? -1;
        if (
          prev < 0 ||
          last < (attachCost[cell] ?? 0) ||
          (last === attachCost[cell] && node.id < (sorted[prev]?.id ?? 0))
        ) {
          attach[cell] = i;
          attachCost[cell] = last;
        }
      }
    }
  }

  return { nodes: sorted, links, adj, warehouse, attach, attachCost, covered };
}
