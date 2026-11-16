// Pathing module (ADR 0010): ref-counted goals, portal-graph distances to
// goal, and lazily computed per-(goal, sector) flow fields. Caches are
// derived data — recomputed on demand, never serialized.
import type { Serializable } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { dijkstra } from './dijkstra';
import { UNREACHABLE } from './dijkstra';
import { buildClassGraph, DIR_ORDER, sectorBounds, sectorDijkstra, sectorOfCell } from './graph';
import type { ClassGraph } from './graph';

export interface Direction {
  dx: number;
  dy: number;
}

export interface PathingApi {
  acquireGoal(x: number, y: number, cls: number): number;
  releaseGoal(goalId: number): void;
  goalRefCount(goalId: number): number;
  // Reuses an internal scratch object — do not hold the result across calls.
  directionAt(goalId: number, x: number, y: number): Direction | null;
  invalidateCells(cells: readonly { x: number; y: number }[]): void;
}

interface Goal {
  x: number;
  y: number;
  cls: number;
  refcount: number;
}

interface SectorField {
  dx: Int8Array;
  dy: Int8Array;
}

export function createPathingModule(
  terrain: TerrainApi,
  classCount: number,
): { module: SimModule; api: PathingApi } {
  const graphs: ClassGraph[] = [];
  for (let cls = 0; cls < classCount; cls++) {
    graphs.push(buildClassGraph(terrain, cls));
  }

  const goals = new Map<number, Goal>();
  const goalByKey = new Map<number, number>();
  const freeIds: number[] = [];
  let nextId = 0;
  // Derived caches (never serialized).
  const portalDists = new Map<number, Int32Array>();
  const fields = new Map<number, SectorField>();
  const scratch: Direction = { dx: 0, dy: 0 };
  // Portal node index by cell, per class — used to continue a field across
  // sector borders at portal cells.
  let nodeIndexByCell = graphs.map(buildNodeIndex);
  function buildNodeIndex(clsGraph: ClassGraph): Map<number, number> {
    const map = new Map<number, number>();
    for (let n = 0; n < clsGraph.graph.nodeCell.length; n++) {
      map.set(clsGraph.graph.nodeCell[n] ?? 0, n);
    }
    return map;
  }

  function goalKey(x: number, y: number, cls: number): number {
    return (cls * terrain.height + y) * terrain.width + x;
  }

  // Distance from every portal node to the goal, on the reversed portal
  // graph, seeded with local-sector distances to the goal cell.
  function portalDistToGoal(goalId: number, goal: Goal): Int32Array {
    const cached = portalDists.get(goalId);
    if (cached !== undefined) {
      return cached;
    }
    const clsGraph = graphs[goal.cls];
    if (clsGraph === undefined) {
      throw new RangeError(`unknown movement class ${goal.cls}`);
    }
    const graph = clsGraph.graph;
    const goalCell = goal.y * terrain.width + goal.x;
    const goalSector = sectorOfCell(terrain, goalCell);
    // dist(x -> goal) within the goal sector = reversed local Dijkstra.
    const local = sectorDijkstra(terrain, goal.cls, goalSector, goalCell, true);
    const { x0, y0, x1 } = sectorBounds(terrain, goalSector);
    const w = x1 - x0 + 1;
    const seeds: [number, number][] = [];
    const nodeCount = graph.nodeCell.length;
    for (let n = 0; n < nodeCount; n++) {
      if (graph.nodeSector[n] !== goalSector) {
        continue;
      }
      const cell = graph.nodeCell[n] ?? 0;
      const cx = cell % terrain.width;
      const cy = Math.floor(cell / terrain.width);
      const d = local[(cy - y0) * w + (cx - x0)] ?? UNREACHABLE;
      if (d < UNREACHABLE) {
        seeds.push([n, d]);
      }
    }
    // Distance TO goal = forward Dijkstra on the transposed adjacency (radj),
    // built once alongside adj in rebuildNodesAndEdges.
    const dist = dijkstra(nodeCount, seeds, (node, visit) => {
      const list = graph.radj[node] ?? [];
      for (let i = 0; i + 1 < list.length; i += 2) {
        visit(list[i] ?? 0, list[i + 1] ?? 0);
      }
    });
    portalDists.set(goalId, dist);
    return dist;
  }

  function fieldKey(goalId: number, sector: number): number {
    return goalId * 4096 + sector;
  }

  // Integration field over one sector seeded with portal-node distances.
  function sectorField(goalId: number, goal: Goal, sector: number): SectorField {
    const key = fieldKey(goalId, sector);
    const cached = fields.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const clsGraph = graphs[goal.cls];
    if (clsGraph === undefined) {
      throw new RangeError(`unknown movement class ${goal.cls}`);
    }
    const graph = clsGraph.graph;
    const dists = portalDistToGoal(goalId, goal);
    const { x0, y0, x1, y1 } = sectorBounds(terrain, sector);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const size = w * h;
    const goalCell = goal.y * terrain.width + goal.x;
    const goalSector = sectorOfCell(terrain, goalCell);

    const seeds: [number, number][] = [];
    if (sector === goalSector) {
      const gx = goal.x - x0;
      const gy = goal.y - y0;
      seeds.push([gy * w + gx, 0]);
    }
    // Boundary portal cells seeded with the portal node's distance-to-goal.
    for (let n = 0; n < graph.nodeCell.length; n++) {
      if (graph.nodeSector[n] !== sector) {
        continue;
      }
      const cell = graph.nodeCell[n] ?? 0;
      const cx = cell % terrain.width;
      const cy = Math.floor(cell / terrain.width);
      const d = dists[n] ?? UNREACHABLE;
      if (d < UNREACHABLE) {
        seeds.push([(cy - y0) * w + (cx - x0), d]);
      }
    }
    const integration = dijkstra(size, seeds, (local, visit) => {
      const cx = x0 + (local % w);
      const cy = y0 + Math.floor(local / w);
      for (const [dx, dy] of DIR_ORDER) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) {
          continue;
        }
        // Cost to move FROM (nx,ny) INTO (cx,cy): integration is distance
        // to goal, so neighbours relax backwards.
        const cost = terrain.stepCost(nx, ny, cx, cy, goal.cls);
        if (cost >= 0) {
          visit((ny - y0) * w + (nx - x0), cost);
        }
      }
    });
    const dx = new Int8Array(size);
    const dy = new Int8Array(size);
    for (let local = 0; local < size; local++) {
      const here = integration[local] ?? UNREACHABLE;
      if (here >= UNREACHABLE || here === 0) {
        continue; // unreachable or the goal cell: direction (0,0)
      }
      const cx = x0 + (local % w);
      const cy = y0 + Math.floor(local / w);
      let best = UNREACHABLE;
      let bestDx = 0;
      let bestDy = 0;
      for (const [ddx, ddy] of DIR_ORDER) {
        const nx = cx + ddx;
        const ny = cy + ddy;
        // Never point across an impassable step (cliff edge, corner cut).
        const step = terrain.stepCost(cx, cy, nx, ny, goal.cls);
        if (step < 0) {
          continue;
        }
        let val: number;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) {
          // Out-of-sector neighbour: only continue across the border through a
          // portal node, valued by its portal-graph distance to the goal.
          const node = nodeIndexByCell[goal.cls]?.get(ny * terrain.width + nx);
          if (node === undefined) {
            continue;
          }
          val = dists[node] ?? UNREACHABLE;
        } else {
          val = integration[(ny - y0) * w + (nx - x0)] ?? UNREACHABLE;
        }
        if (val >= UNREACHABLE) {
          continue;
        }
        const total = val + step;
        if (total < best) {
          best = total;
          bestDx = ddx;
          bestDy = ddy;
        }
      }
      dx[local] = bestDx;
      dy[local] = bestDy;
    }
    const field = { dx, dy };
    fields.set(key, field);
    return field;
  }

  function acquireGoal(x: number, y: number, cls: number): number {
    const key = goalKey(x, y, cls);
    const existing = goalByKey.get(key);
    if (existing !== undefined) {
      const goal = goals.get(existing);
      if (goal !== undefined) {
        goal.refcount += 1;
      }
      return existing;
    }
    const id = freeIds.length > 0 ? (freeIds.shift() ?? 0) : nextId++;
    goals.set(id, { x, y, cls, refcount: 1 });
    goalByKey.set(key, id);
    return id;
  }

  function releaseGoal(goalId: number): void {
    const goal = goals.get(goalId);
    if (goal === undefined) {
      return;
    }
    goal.refcount -= 1;
    if (goal.refcount > 0) {
      return;
    }
    goals.delete(goalId);
    goalByKey.delete(goalKey(goal.x, goal.y, goal.cls));
    portalDists.delete(goalId);
    for (const key of fields.keys()) {
      if (Math.floor(key / 4096) === goalId) {
        fields.delete(key);
      }
    }
    // Lowest-free-id reuse: keep the free list sorted.
    const insertAt = freeIds.findIndex((f) => f > goalId);
    if (insertAt === -1) {
      freeIds.push(goalId);
    } else {
      freeIds.splice(insertAt, 0, goalId);
    }
  }

  const api: PathingApi = {
    acquireGoal,
    releaseGoal,

    goalRefCount(goalId) {
      return goals.get(goalId)?.refcount ?? 0;
    },

    directionAt(goalId, x, y) {
      const goal = goals.get(goalId);
      if (goal === undefined || !terrain.inBounds(x, y)) {
        return null;
      }
      const sector = sectorOfCell(terrain, y * terrain.width + x);
      const field = sectorField(goalId, goal, sector);
      const { x0, y0, x1 } = sectorBounds(terrain, sector);
      const w = x1 - x0 + 1;
      const local = (y - y0) * w + (x - x0);
      const dx = field.dx[local] ?? 0;
      const dy = field.dy[local] ?? 0;
      // (0,0) on a non-goal cell means unreachable.
      if (dx === 0 && dy === 0) {
        const isGoal = x === goal.x && y === goal.y;
        if (!isGoal) {
          return null;
        }
      }
      scratch.dx = dx;
      scratch.dy = dy;
      return scratch;
    },

    invalidateCells(cells) {
      for (const clsGraph of graphs) {
        clsGraph.invalidate(cells);
      }
      nodeIndexByCell = graphs.map(buildNodeIndex);
      // Portal-node indices change on rebuild: all cached distances are
      // stale, and every sector field derives from them.
      portalDists.clear();
      fields.clear();
    },
  };

  const module: SimModule = {
    id: 'frontline_td:pathing',
    install(builder) {
      builder.state('frontline_td:pathing.goals', {
        save(): Serializable {
          const entries = [...goals.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([id, g]) => ({ id, x: g.x, y: g.y, cls: g.cls, ref: g.refcount }));
          return { nextId, freeIds: [...freeIds], entries };
        },
        load(data: Serializable): void {
          const saved = data as {
            nextId: number;
            freeIds: number[];
            entries: { id: number; x: number; y: number; cls: number; ref: number }[];
          };
          goals.clear();
          goalByKey.clear();
          freeIds.length = 0;
          freeIds.push(...saved.freeIds);
          nextId = saved.nextId;
          for (const entry of saved.entries) {
            goals.set(entry.id, {
              x: entry.x,
              y: entry.y,
              cls: entry.cls,
              refcount: entry.ref,
            });
            goalByKey.set(goalKey(entry.x, entry.y, entry.cls), entry.id);
          }
        },
      });
    },
  };
  return { module, api };
}
