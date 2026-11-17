// Bounded ring-seeded ground searches used to build the logistics
// topology (E4 perf): a shared scratch distance array reset via a
// touched-cell list, a flat encoded binary heap, an early-exit settle
// callback, and a per-rebuild directed-edge step cache, so a faction
// rebuild neither allocates per node nor recomputes edge costs across
// the overlapping searches. Distances and expansion order are
// bit-identical to the generic pathing dijkstra.
import { UNREACHABLE, DIR_ORDER } from '../../pathing/sim/index';
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

// Bounded ring-search scratch (E4 perf): one reusable distance array, a
// touched-cell list for reset, and a flat encoded binary heap shared by
// consecutive node searches, so a faction rebuild doesn't allocate or
// re-fill a full-map array per node. Heap entries encode cost * size +
// cell, so numeric order is (cost, cell) — the same pop order as the
// generic dijkstra's (cost, node) comparator; expansion order and edge
// costs are identical, so distances are bit-identical.
interface RingScratch {
  dist: Int32Array;
  heap: number[];
  touched: number[];
}
let ringScratch: RingScratch | null = null;

// Per-rebuild directed-edge step cache (E4 perf): the node's searches
// overlap heavily, so each directed edge's stepCost is computed once
// and reused (terrain/blockers are constant within a rebuild). -2 =
// not yet computed; -1 = impassable; otherwise the step cost.
function stepCached(
  edge: Int16Array | null,
  cell: number,
  dir: number,
  terrain: TerrainApi,
  cls: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
): number {
  if (edge === null) {
    return terrain.stepCost(x, y, nx, ny, cls);
  }
  const slot = cell * 8 + dir;
  let s = edge[slot] ?? -2;
  if (s === -2) {
    s = terrain.stepCost(x, y, nx, ny, cls);
    edge[slot] = s;
  }
  return s;
}

export function ringSearch(
  terrain: TerrainApi,
  cls: number,
  ring: readonly number[],
  maxCost: number,
  // Called for each cell as it settles (pop order = nondecreasing cost);
  // returning true stops the search early. Stopping is safe for callers
  // that only need settled distances: a stopped search leaves every
  // unrecorded cell at UNREACHABLE, as if it had run to exhaustion.
  settled?: (cell: number, cost: number) => boolean,
  edge?: Int16Array | null,
): { dist: Int32Array; touched: readonly number[] } {
  const size = terrain.width * terrain.height;
  if (ringScratch === null || ringScratch.dist.length < size) {
    ringScratch = {
      dist: new Int32Array(size).fill(UNREACHABLE),
      heap: [],
      touched: [],
    };
  }
  const s = ringScratch;
  for (const c of s.touched) {
    s.dist[c] = UNREACHABLE;
  }
  s.touched.length = 0;
  const dist = s.dist;
  const heap = s.heap;
  heap.length = 0;
  const w = terrain.width;
  const h = terrain.height;

  const push = (entry: number): void => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[i] ?? 0) >= (heap[p] ?? 0)) {
        break;
      }
      const t = heap[i] ?? 0;
      heap[i] = heap[p] ?? 0;
      heap[p] = t;
      i = p;
    }
  };
  const pop = (): number => {
    const last = heap.pop() ?? 0;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && (heap[l] ?? 0) < (heap[smallest] ?? 0)) {
          smallest = l;
        }
        if (r < heap.length && (heap[r] ?? 0) < (heap[smallest] ?? 0)) {
          smallest = r;
        }
        if (smallest === i) {
          break;
        }
        const t = heap[i] ?? 0;
        heap[i] = heap[smallest] ?? 0;
        heap[smallest] = t;
        i = smallest;
      }
    }
    return last;
  };

  for (const cell of ring) {
    if (0 < (dist[cell] ?? UNREACHABLE)) {
      dist[cell] = 0;
      s.touched.push(cell);
      push(cell);
    }
  }
  while (heap.length > 0) {
    const entry = heap[0] ?? 0;
    pop();
    const cost = Math.floor(entry / size);
    const cell = entry - cost * size;
    if (cost !== dist[cell]) {
      continue; // stale entry
    }
    if (cost > maxCost) {
      break; // the heap is ordered: everything left is at least as far
    }
    if (settled !== undefined && settled(cell, cost)) {
      break;
    }
    const x = cell % w;
    const y = (cell / w) | 0;
    for (let dir = 0; dir < 8; dir++) {
      const d = DIR_ORDER[dir] as readonly [number, number];
      const nx = x + d[0];
      const ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        continue;
      }
      const step = stepCached(edge ?? null, cell, dir, terrain, cls, x, y, nx, ny);
      if (step < 0) {
        continue;
      }
      const to = ny * w + nx;
      const next = cost + step;
      // Cells beyond maxCost are never recorded: distances are exact up
      // to the bound and UNREACHABLE beyond it.
      if (next < (dist[to] ?? UNREACHABLE) && next <= maxCost) {
        if (dist[to] === UNREACHABLE) {
          s.touched.push(to);
        }
        dist[to] = next;
        push(next * size + to);
      }
    }
  }
  return s;
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
  // Copy out: callers keep the field while later searches reuse it.
  return ringSearch(terrain, cls, ring, maxCost).dist.slice();
}

// Greedy descent on the distance field from `start` (a cell of b's ring)
// down to a's seed cells (dist 0). A step is only legal when the neighbour
// is a true predecessor: the dijkstra edge next -> cur must exist and
// attain dist[cur], so the polyline never steps across a cliff or a
// blocked edge. Neighbour order is the fixed DIR_ORDER.
export function descentPath(
  dist: Int32Array,
  terrain: TerrainApi,
  cls: number,
  start: number,
): { cells: number[]; steps: number[] } {
  const w = terrain.width;
  const cells = [start];
  const steps = [0];
  let cur = start;
  let curD = dist[cur] ?? UNREACHABLE;
  while (curD > 0) {
    const x = cur % w;
    const y = (cur / w) | 0;
    let next = -1;
    let nextD = curD;
    let nextStep = 0;
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
        nextStep = step;
        if (d === 0) {
          break;
        }
      }
    }
    if (next < 0) {
      break;
    }
    // `step` is the cost of the edge next -> cur, attributed to the
    // destination cur; after the reverse it lines up with cells[k].
    steps[steps.length - 1] = nextStep;
    cells.push(next);
    steps.push(0);
    cur = next;
    curD = nextD;
  }
  cells.reverse();
  steps.reverse();
  return { cells, steps };
}
