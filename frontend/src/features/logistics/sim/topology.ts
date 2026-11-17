// Derived logistics topology (ADR 0025): per-faction node lists, ground
// links between node footprints, the coverage mask and the nearest-node
// attachment array. Everything here is derived state — rebuilt lazily when
// the node set, terrain blockers or a save load make it dirty — so none of
// it is serialized.
import { floorDiv } from '../../../core/index';
import type { ReadonlyNumberArray } from '../../../kernel/index';
import { UNREACHABLE } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';

export type { TopoNode } from './ring-search';
export { ringCells, ringDistances } from './ring-search';
import { descentPath, ringCells, ringSearch } from './ring-search';
import type { TopoNode } from './ring-search';

interface TopoLink {
  // Node indices, a < b.
  a: number;
  b: number;
  // Ground path cost (cost units) — the link length L.
  cost: number;
  // Time-weighted (step-cost harmonic mean) road multiplier in bp
  // (recomputed on road changes).
  m: number;
  // Path cells from a's ring to b's ring (y * width + x).
  cells: number[];
  // Step cost into each cell: steps[k] is the cost of the edge
  // cells[k-1] -> cells[k]; steps[0] = 0 (the a-ring seed).
  steps: number[];
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
  // Road-layer version the link multipliers were computed against.
  roadV: number;
  // Cells whose blocking could change this topology (ADR 0030): every
  // link polyline cell and every node ring cell. Blocking elsewhere can
  // only lengthen distances, which changes no ring, link or path.
  sensitive: Uint8Array;
}

// Effective multiplier of one link: floor(cost*10000 / Σ step_k*10000 /
// m(cell_k)) — the harmonic mean of the per-cell road multipliers weighted
// by step cost (the step is attributed to its destination cell; the seed
// cell carries no step). Integer math only.
export function linkMultiplier(
  link: { cost: number; cells: readonly number[]; steps: readonly number[] },
  roads: ReadonlyNumberArray,
  roadMult: readonly number[],
): number {
  let den = 0;
  for (let k = 1; k < link.cells.length; k++) {
    const m = roadMult[roads[link.cells[k] ?? 0] ?? 0] ?? 10000;
    den += floorDiv((link.steps[k] ?? 0) * 10000, m);
  }
  if (den <= 0) {
    return roadMult[0] ?? 10000;
  }
  return floorDiv(link.cost * 10000, den);
}

// One bounded dijkstra per node (bound = its own connect), seeded from
// its ring. Node i's distance field then serves every j > i: link i–j
// exists when the best ring-j distance is <= min(connect_i, connect_j).
// Identical to a per-pair bounded search because the tighter pair bound
// only truncates distances that already exceed it. Roads never affect
// the search — only the per-link multiplier.
export function buildFactionTopo(
  nodes: TopoNode[],
  terrain: TerrainApi,
  cls: number,
  roads: ReadonlyNumberArray,
  roadMult: readonly number[],
  roadV: number,
): FactionTopo {
  const size = terrain.width * terrain.height;
  const sorted = [...nodes].sort((x, y) => x.id - y.id);
  const rings = sorted.map((n) => ringCells(n, terrain, cls));
  // Ring membership for the early-exit scans below: cell -> node indices.
  const ringOf = new Map<number, number[]>();
  rings.forEach((cells, i) => {
    for (const c of cells) {
      const list = ringOf.get(c);
      if (list === undefined) {
        ringOf.set(c, [i]);
      } else {
        list.push(i);
      }
    }
  });
  const links: TopoLink[] = [];
  const adj: number[][] = sorted.map(() => []);
  // Directed-edge step cache shared by this rebuild's searches.
  const edge = new Int16Array(size * 8).fill(-2);
  for (let i = 0; i < sorted.length; i++) {
    // Node i's distance field serves every j > i; it is only needed for
    // this row, so the searches share one scratch buffer. The search
    // stops as soon as every candidate j is settled (its minimum ring
    // distance pops first, ordered by cost then cell — the same pick
    // the old full-field scan produced) or proven unreachable.
    const a = sorted[i] as TopoNode;
    const ring = rings[i] ?? [];
    if (ring.length === 0) {
      continue;
    }
    const remaining = new Map<number, number>();
    let maxBound = 0;
    for (let j = i + 1; j < sorted.length; j++) {
      const bound = Math.min(a.connect, (sorted[j] as TopoNode).connect);
      remaining.set(j, bound);
      maxBound = Math.max(maxBound, bound);
    }
    // j -> the first settled ring cell (its minimum distance).
    const found = new Map<number, { cell: number; cost: number }>();
    const search = ringSearch(
      terrain,
      cls,
      ring,
      a.connect,
      (cell, cost) => {
        if (cost > maxBound) {
          return true;
        }
        for (const j of ringOf.get(cell) ?? []) {
          const bound = remaining.get(j);
          if (bound === undefined) {
            continue;
          }
          remaining.delete(j);
          if (cost <= bound) {
            found.set(j, { cell, cost });
          }
          // j is decided either way: later pops are no nearer.
        }
        return remaining.size === 0;
      },
      edge,
    );
    const dist = search.dist;
    for (const [j, hit] of [...found.entries()].sort((x, y) => x[0] - y[0])) {
      const best = hit.cell;
      const bestD = hit.cost;
      const index = links.length;
      const path = descentPath(dist, terrain, cls, best);
      links.push({
        a: i,
        b: j,
        cost: bestD,
        m: linkMultiplier({ cost: bestD, cells: path.cells, steps: path.steps }, roads, roadMult),
        cells: path.cells,
        steps: path.steps,
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

  const sensitive = new Uint8Array(size);
  for (const cells of rings) {
    for (const c of cells) {
      sensitive[c] = 1;
    }
  }
  for (const link of links) {
    for (const c of link.cells) {
      sensitive[c] = 1;
    }
  }

  return { nodes: sorted, links, adj, warehouse, attach, attachCost, covered, roadV, sensitive };
}
