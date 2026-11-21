// Portal-graph construction for one movement class (ADR 0010): portals on
// every sector boundary, intra-sector edge tables, and sector-scoped
// invalidation. All costs are integers via TerrainApi.
import type { TerrainApi } from '../../terrain/sim/index';
import { CLEARANCE_HEAVY, CLEARANCE_STANDARD, type ClearanceTier } from '../../terrain/rules/index';
import { UNREACHABLE, dijkstra } from './dijkstra';

const SECTOR_SIZE = 16;

// Neighbour order for direction pick: N, E, S, W, NE, SE, SW, NW.
export const DIR_ORDER = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
] as const;

interface Portal {
  // Cell indices of the two sides; a is in the lower-indexed sector.
  a: number;
  b: number;
  sectorA: number;
  sectorB: number;
  // stepCost of the middle step a->b and b->a.
  costAB: number;
  costBA: number;
}

interface PortalGraph {
  portals: Portal[];
  // Half-nodes: node 2p is portal p's a-side cell, node 2p+1 the b-side.
  nodeCell: Int32Array;
  nodeSector: Int32Array;
  // Directed adjacency: adj[n] = [to, cost, to, cost, ...].
  adj: number[][];
  // Transposed adjacency for distance-TO-goal queries: radj[n] = [from, cost].
  radj: number[][];
  // Portal cells grouped by sector, for intra-sector Dijkstra seeding.
  portalCellsBySector: Int32Array[];
  sectorCols: number;
  sectorRows: number;
  sectorCount: number;
}

function cellIndex(terrain: TerrainApi, x: number, y: number): number {
  return y * terrain.width + x;
}

export function sectorOfCell(terrain: TerrainApi, cell: number): number {
  const x = cell % terrain.width;
  const y = Math.floor(cell / terrain.width);
  const cols = Math.ceil(terrain.width / SECTOR_SIZE);
  return Math.floor(y / SECTOR_SIZE) * cols + Math.floor(x / SECTOR_SIZE);
}

function sectorDims(terrain: TerrainApi): { cols: number; rows: number } {
  return {
    cols: Math.ceil(terrain.width / SECTOR_SIZE),
    rows: Math.ceil(terrain.height / SECTOR_SIZE),
  };
}

export function sectorBounds(
  terrain: TerrainApi,
  sector: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const { cols } = sectorDims(terrain);
  const sx = sector % cols;
  const sy = Math.floor(sector / cols);
  return {
    x0: sx * SECTOR_SIZE,
    y0: sy * SECTOR_SIZE,
    x1: Math.min((sx + 1) * SECTOR_SIZE, terrain.width) - 1,
    y1: Math.min((sy + 1) * SECTOR_SIZE, terrain.height) - 1,
  };
}

type BoundaryKey = string;

function boundaryKey(vertical: boolean, coord: number): BoundaryKey {
  return vertical ? `v${coord}` : `h${coord}`;
}

// The boundaries touched by a sector (each shared boundary appears once).
function sectorBoundaries(
  terrain: TerrainApi,
  sector: number,
): { key: BoundaryKey; vertical: boolean; coord: number }[] {
  const { x0, y0, x1, y1 } = sectorBounds(terrain, sector);
  const out: { key: BoundaryKey; vertical: boolean; coord: number }[] = [];
  for (const coord of [x0, x1 + 1]) {
    if (coord > 0 && coord < terrain.width) {
      out.push({ key: boundaryKey(true, coord), vertical: true, coord });
    }
  }
  for (const coord of [y0, y1 + 1]) {
    if (coord > 0 && coord < terrain.height) {
      out.push({ key: boundaryKey(false, coord), vertical: false, coord });
    }
  }
  return out;
}

// Scan one boundary: maximal runs of adjacent cell pairs passable both ways.
function scanBoundary(
  terrain: TerrainApi,
  cls: number,
  vertical: boolean,
  coord: number,
  tier: ClearanceTier = CLEARANCE_STANDARD,
): Portal[] {
  const portals: Portal[] = [];
  let run: [number, number, number, number][] = []; // [ax,ay,bx,by]
  const flush = (): void => {
    if (run.length === 0) {
      return;
    }
    // A run can span several sectors along the boundary; a single portal
    // would only link the midpoint's sector pair and leave the others
    // disconnected. Emit one portal per sector strip the run overlaps.
    const runPos = (i: number): number => (vertical ? (run[i]?.[1] ?? 0) : (run[i]?.[0] ?? 0));
    let segStart = 0;
    while (segStart < run.length) {
      const strip = Math.floor(runPos(segStart) / SECTOR_SIZE);
      let segEnd = segStart;
      while (segEnd < run.length) {
        const cellPos = runPos(segEnd);
        if (Math.floor(cellPos / SECTOR_SIZE) !== strip) {
          break;
        }
        segEnd += 1;
      }
      const mid = run[segStart + Math.floor((segEnd - segStart) / 2)] ?? [0, 0, 0, 0];
      portals.push({
        a: cellIndex(terrain, mid[0], mid[1]),
        b: cellIndex(terrain, mid[2], mid[3]),
        sectorA: sectorOfCell(terrain, cellIndex(terrain, mid[0], mid[1])),
        sectorB: sectorOfCell(terrain, cellIndex(terrain, mid[2], mid[3])),
        costAB: terrain.stepCost(mid[0], mid[1], mid[2], mid[3], cls, tier),
        costBA: terrain.stepCost(mid[2], mid[3], mid[0], mid[1], cls, tier),
      });
      segStart = segEnd;
    }
    run = [];
  };
  const limit = vertical ? terrain.height : terrain.width;
  for (let t = 0; t < limit; t++) {
    const ax = vertical ? coord - 1 : t;
    const ay = vertical ? t : coord - 1;
    const bx = vertical ? coord : t;
    const by = vertical ? t : coord;
    const bothWays =
      terrain.stepCost(ax, ay, bx, by, cls, tier) >= 0 &&
      terrain.stepCost(bx, by, ax, ay, cls, tier) >= 0;
    if (bothWays) {
      run.push([ax, ay, bx, by]);
    } else {
      flush();
    }
  }
  flush();
  return portals;
}

// Directed local Dijkstra inside one sector. `reverse` computes distances
// TO `from` (used for portal-distance queries).
export function sectorDijkstra(
  terrain: TerrainApi,
  cls: number,
  sector: number,
  from: number,
  reverse = false,
  tier: ClearanceTier = CLEARANCE_STANDARD,
): Int32Array {
  const { x0, y0, x1, y1 } = sectorBounds(terrain, sector);
  const w = x1 - x0 + 1;
  const size = w * (y1 - y0 + 1);
  const fx = from % terrain.width;
  const fy = Math.floor(from / terrain.width);
  const start = (fy - y0) * w + (fx - x0);
  return dijkstra(size, [[start, 0]], (local, visit) => {
    const cx = x0 + (local % w);
    const cy = y0 + Math.floor(local / w);
    for (const [dx, dy] of DIR_ORDER) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) {
        continue;
      }
      const cost = reverse
        ? terrain.stepCost(nx, ny, cx, cy, cls, tier)
        : terrain.stepCost(cx, cy, nx, ny, cls, tier);
      if (cost >= 0) {
        visit((ny - y0) * w + (nx - x0), cost);
      }
    }
  });
}

interface ClassData {
  boundaryPortals: Map<BoundaryKey, Portal[]>;
  sectorEdges: Map<number, { a: number; b: number; cost: number }[]>;
  graph: PortalGraph;
}

// Compute the intra-sector edge table for one sector from its portal cells.
function computeSectorEdges(
  terrain: TerrainApi,
  cls: number,
  sector: number,
  cells: Iterable<number>,
  tier: ClearanceTier = CLEARANCE_STANDARD,
): { a: number; b: number; cost: number }[] {
  const edges: { a: number; b: number; cost: number }[] = [];
  for (const cell of cells) {
    const dist = sectorDijkstra(terrain, cls, sector, cell, false, tier);
    const { x0, y0, x1 } = sectorBounds(terrain, sector);
    const w = x1 - x0 + 1;
    for (const other of cells) {
      if (other === cell) {
        continue;
      }
      const ox = other % terrain.width;
      const oy = Math.floor(other / terrain.width);
      const cost = dist[(oy - y0) * w + (ox - x0)] ?? UNREACHABLE;
      if (cost < UNREACHABLE) {
        edges.push({ a: cell, b: other, cost });
      }
    }
  }
  return edges;
}

export interface ClassGraph {
  graph: PortalGraph;
  // Recompute portals + intra tables for touched sectors and 4-neighbours.
  invalidate(touched: readonly { x: number; y: number }[]): void;
}

export function buildClassGraph(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier = CLEARANCE_STANDARD,
): ClassGraph {
  const { cols, rows } = sectorDims(terrain);
  const data: ClassData = {
    boundaryPortals: new Map(),
    sectorEdges: new Map(),
    graph: {
      portals: [],
      nodeCell: new Int32Array(0),
      nodeSector: new Int32Array(0),
      adj: [],
      radj: [],
      portalCellsBySector: [],
      sectorCols: cols,
      sectorRows: rows,
      sectorCount: cols * rows,
    },
  };

  function collectPortalCells(): Int32Array[] {
    const bySector: number[][] = Array.from({ length: cols * rows }, () => []);
    for (const portals of data.boundaryPortals.values()) {
      for (const portal of portals) {
        (bySector[portal.sectorA] ?? []).push(portal.a);
        (bySector[portal.sectorB] ?? []).push(portal.b);
      }
    }
    return bySector.map((cells) => {
      cells.sort((a, b) => a - b);
      return Int32Array.from(cells);
    });
  }

  function rebuildNodesAndEdges(): void {
    const portals: Portal[] = [];
    const bySector = collectPortalCells();
    for (const list of data.boundaryPortals.values()) {
      for (const portal of list) {
        portals.push(portal);
      }
    }
    // Deterministic node order: sort portals by (cellA, cellB).
    portals.sort((p, q) => p.a - q.a || p.b - q.b);
    const nodeCell = new Int32Array(portals.length * 2);
    const nodeSector = new Int32Array(portals.length * 2);
    const nodeOfCell = new Map<number, number>();
    portals.forEach((portal, p) => {
      nodeCell[p * 2] = portal.a;
      nodeSector[p * 2] = portal.sectorA;
      nodeCell[p * 2 + 1] = portal.b;
      nodeSector[p * 2 + 1] = portal.sectorB;
      nodeOfCell.set(portal.a, p * 2);
      nodeOfCell.set(portal.b, p * 2 + 1);
    });
    const adj: number[][] = Array.from({ length: nodeCell.length }, () => []);
    for (const portal of portals) {
      // Crossing edges (the middle step) in both directions.
      (adj[nodeOfCell.get(portal.a) ?? 0] ?? []).push(nodeOfCell.get(portal.b) ?? 0, portal.costAB);
      (adj[nodeOfCell.get(portal.b) ?? 0] ?? []).push(nodeOfCell.get(portal.a) ?? 0, portal.costBA);
    }
    for (const edges of data.sectorEdges.values()) {
      for (const edge of edges) {
        (adj[nodeOfCell.get(edge.a) ?? 0] ?? []).push(nodeOfCell.get(edge.b) ?? 0, edge.cost);
      }
    }
    // Deterministic adjacency order: sort each list by (to, cost).
    for (const list of adj) {
      const pairs: [number, number][] = [];
      for (let i = 0; i + 1 < list.length; i += 2) {
        pairs.push([list[i] ?? 0, list[i + 1] ?? 0]);
      }
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      list.length = 0;
      for (const [to, cost] of pairs) {
        list.push(to, cost);
      }
    }
    const radj: number[][] = Array.from({ length: adj.length }, () => []);
    adj.forEach((list, from) => {
      for (let i = 0; i + 1 < list.length; i += 2) {
        (radj[list[i] ?? 0] ?? []).push(from, list[i + 1] ?? 0);
      }
    });
    for (const list of radj) {
      const pairs: [number, number][] = [];
      for (let i = 0; i + 1 < list.length; i += 2) {
        pairs.push([list[i] ?? 0, list[i + 1] ?? 0]);
      }
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      list.length = 0;
      for (const [from, cost] of pairs) {
        list.push(from, cost);
      }
    }
    data.graph = {
      portals,
      nodeCell,
      nodeSector,
      adj,
      radj,
      portalCellsBySector: bySector,
      sectorCols: cols,
      sectorRows: rows,
      sectorCount: cols * rows,
    };
  }

  // Initial full build: scan all boundaries, compute all sector tables.
  for (let bx = SECTOR_SIZE; bx < terrain.width; bx += SECTOR_SIZE) {
    data.boundaryPortals.set(boundaryKey(true, bx), scanBoundary(terrain, cls, true, bx, tier));
  }
  for (let by = SECTOR_SIZE; by < terrain.height; by += SECTOR_SIZE) {
    data.boundaryPortals.set(boundaryKey(false, by), scanBoundary(terrain, cls, false, by, tier));
  }
  const bySector = collectPortalCells();
  for (let s = 0; s < cols * rows; s++) {
    data.sectorEdges.set(s, computeSectorEdges(terrain, cls, s, bySector[s] ?? [], tier));
  }
  rebuildNodesAndEdges();

  return {
    get graph() {
      return data.graph;
    },
    invalidate(touched) {
      const affected = new Set<number>();
      const markSectorAndNeighbors = (cx: number, cy: number): void => {
        if (!terrain.inBounds(cx, cy)) {
          return;
        }
        const s = sectorOfCell(terrain, cellIndex(terrain, cx, cy));
        const sx = s % cols;
        const sy = Math.floor(s / cols);
        for (const [dx, dy] of [
          [0, 0],
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const) {
          const nsx = sx + dx;
          const nsy = sy + dy;
          if (nsx >= 0 && nsx < cols && nsy >= 0 && nsy < rows) {
            affected.add(nsy * cols + nsx);
          }
        }
      };
      for (const cell of touched) {
        if (tier === CLEARANCE_HEAVY) {
          // A 2x2 footprint anchored at (x - ox, y - oy) overlaps (x, y);
          // expanding before sector lookup covers diagonal corner blockers.
          for (let oy = 0; oy <= 1; oy++) {
            for (let ox = 0; ox <= 1; ox++) {
              markSectorAndNeighbors(cell.x - ox, cell.y - oy);
            }
          }
        } else {
          markSectorAndNeighbors(cell.x, cell.y);
        }
      }
      // Rescan every boundary touching an affected sector.
      const boundaries = new Map<BoundaryKey, { vertical: boolean; coord: number }>();
      for (const s of affected) {
        for (const b of sectorBoundaries(terrain, s)) {
          boundaries.set(b.key, b);
        }
      }
      for (const [key, b] of boundaries) {
        data.boundaryPortals.set(key, scanBoundary(terrain, cls, b.vertical, b.coord, tier));
      }
      const updatedCells = collectPortalCells();
      for (const s of affected) {
        data.sectorEdges.set(s, computeSectorEdges(terrain, cls, s, updatedCells[s] ?? [], tier));
      }
      rebuildNodesAndEdges();
    },
  };
}
