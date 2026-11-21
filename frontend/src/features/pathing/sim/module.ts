// Pathing module (ADR 0010): ref-counted goals, portal-graph distances to
// goal, and lazily computed per-(goal, sector) flow fields. Caches are
// derived data — recomputed on demand, never serialized.
import type { Serializable } from '../../../core/index';
import type { SimModule } from '../../../kernel/index';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  CLEARANCE_TIERS,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { dijkstra } from './dijkstra';
import { UNREACHABLE } from './dijkstra';
import { buildClassGraph, DIR_ORDER, sectorBounds, sectorDijkstra, sectorOfCell } from './graph';
import type { ClassGraph } from './graph';

interface Direction {
  dx: number;
  dy: number;
}

export interface PathingApi {
  acquireGoal(x: number, y: number, cls: number, tier?: ClearanceTier): number;
  releaseGoal(goalId: number): void;
  goalRefCount(goalId: number): number;
  // Reuses an internal scratch object — do not hold the result across calls.
  directionAt(goalId: number, x: number, y: number): Direction | null;
  // Reuses a separate internal scratch object — safe to interleave with directionAt.
  smoothDirectionAt(goalId: number, px: number, py: number): Direction | null;
  invalidateCells(cells: readonly { x: number; y: number }[]): void;
}

interface Goal {
  x: number;
  y: number;
  cls: number;
  tier: ClearanceTier;
  refcount: number;
}

interface SectorField {
  dx: Int8Array;
  dy: Int8Array;
  cost: Int32Array;
}

function edgePassableBothWays(
  terrain: TerrainApi,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cls: number,
  tier: ClearanceTier,
): boolean {
  return (
    terrain.stepCost(ax, ay, bx, by, cls, tier) >= 0 &&
    terrain.stepCost(bx, by, ax, ay, cls, tier) >= 0
  );
}

function quadPassableBothWays(
  terrain: TerrainApi,
  x00: number,
  y00: number,
  cls: number,
  tier: ClearanceTier,
): boolean {
  const x10 = x00 + 1;
  const y01 = y00 + 1;
  return (
    edgePassableBothWays(terrain, x00, y00, x10, y00, cls, tier) &&
    edgePassableBothWays(terrain, x00, y01, x10, y01, cls, tier) &&
    edgePassableBothWays(terrain, x00, y00, x00, y01, cls, tier) &&
    edgePassableBothWays(terrain, x10, y00, x10, y01, cls, tier) &&
    edgePassableBothWays(terrain, x00, y00, x10, y01, cls, tier) &&
    edgePassableBothWays(terrain, x10, y00, x00, y01, cls, tier)
  );
}

export function createPathingModule(
  terrain: TerrainApi,
  classCount: number,
): { module: SimModule; api: PathingApi } {
  const goals = new Map<number, Goal>();
  const goalByKey = new Map<number, number>();
  const freeIds: number[] = [];
  let nextId = 0;
  // Derived caches (never serialized).
  const portalDists = new Map<number, Int32Array>();
  const fields = new Map<number, SectorField>();
  const scratch: Direction = { dx: 0, dy: 0 };
  const smoothScratch: Direction = { dx: 0, dy: 0 };
  const totalSlots = classCount * CLEARANCE_TIERS;
  // Portal node index by cell, per (class, tier) slot — used to continue a
  // field across sector borders at portal cells.
  let nodeIndexByCell: (Map<number, number> | undefined)[] = [];
  // Rebuilt on state load: the terrain blocked overlay is restored before
  // pathing's load runs, and graphs must reflect it (see sim-registry order).
  // Standard tier (0) graphs build eagerly; heavy tier (1) graphs build lazily.
  let graphs: (ClassGraph | undefined)[] = [];
  function graphSlot(cls: number, tier: ClearanceTier): number {
    return tier * classCount + cls;
  }
  function buildNodeIndex(clsGraph: ClassGraph): Map<number, number> {
    const map = new Map<number, number>();
    for (let n = 0; n < clsGraph.graph.nodeCell.length; n++) {
      map.set(clsGraph.graph.nodeCell[n] ?? 0, n);
    }
    return map;
  }
  function ensureGraph(cls: number, tier: ClearanceTier): ClassGraph {
    if (cls < 0 || cls >= classCount) {
      throw new RangeError(`unknown movement class ${cls}`);
    }
    const slot = graphSlot(cls, tier);
    let clsGraph = graphs[slot];
    if (clsGraph === undefined) {
      clsGraph = buildClassGraph(terrain, cls, tier);
      graphs[slot] = clsGraph;
      nodeIndexByCell[slot] = buildNodeIndex(clsGraph);
    }
    return clsGraph;
  }
  function rebuildGraphs(): void {
    graphs = Array.from({ length: totalSlots }, () => undefined);
    nodeIndexByCell = Array.from({ length: totalSlots }, () => undefined);
    for (let cls = 0; cls < classCount; cls++) {
      const slot = graphSlot(cls, CLEARANCE_STANDARD);
      const clsGraph = buildClassGraph(terrain, cls, CLEARANCE_STANDARD);
      graphs[slot] = clsGraph;
      nodeIndexByCell[slot] = buildNodeIndex(clsGraph);
    }
    portalDists.clear();
    fields.clear();
  }
  rebuildGraphs();

  function goalKey(x: number, y: number, cls: number, tier: ClearanceTier): number {
    return ((tier * classCount + cls) * terrain.height + y) * terrain.width + x;
  }

  // Distance from every portal node to the goal, on the reversed portal
  // graph, seeded with local-sector distances to the goal cell.
  function portalDistToGoal(goalId: number, goal: Goal): Int32Array {
    const cached = portalDists.get(goalId);
    if (cached !== undefined) {
      return cached;
    }
    const clsGraph = ensureGraph(goal.cls, goal.tier);
    const graph = clsGraph.graph;
    const goalCell = goal.y * terrain.width + goal.x;
    const goalSector = sectorOfCell(terrain, goalCell);
    // dist(x -> goal) within the goal sector = reversed local Dijkstra.
    const local = sectorDijkstra(terrain, goal.cls, goalSector, goalCell, true, goal.tier);
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
    const clsGraph = ensureGraph(goal.cls, goal.tier);
    const slot = graphSlot(goal.cls, goal.tier);
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
        const cost = terrain.stepCost(nx, ny, cx, cy, goal.cls, goal.tier);
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
        const step = terrain.stepCost(cx, cy, nx, ny, goal.cls, goal.tier);
        if (step < 0) {
          continue;
        }
        let val: number;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) {
          // Out-of-sector neighbour: only continue across the border through a
          // portal node, valued by its portal-graph distance to the goal.
          const node = nodeIndexByCell[slot]?.get(ny * terrain.width + nx);
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
    const field = { dx, dy, cost: integration };
    fields.set(key, field);
    return field;
  }

  function discreteDirAt(
    goalId: number,
    goal: Goal,
    x: number,
    y: number,
    out: Direction,
  ): SectorField | null {
    if (!terrain.inBounds(x, y)) {
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
    out.dx = dx;
    out.dy = dy;
    return field;
  }

  function acquireGoal(
    x: number,
    y: number,
    cls: number,
    tier: ClearanceTier = CLEARANCE_STANDARD,
  ): number {
    // Goals are cells: quantize so callers may pass entity positions.
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const resolvedTier: ClearanceTier =
      tier === CLEARANCE_HEAVY ? CLEARANCE_HEAVY : CLEARANCE_STANDARD;
    const key = goalKey(gx, gy, cls, resolvedTier);
    const existing = goalByKey.get(key);
    if (existing !== undefined) {
      const goal = goals.get(existing);
      if (goal !== undefined) {
        goal.refcount += 1;
      }
      return existing;
    }
    const id = freeIds.length > 0 ? (freeIds.shift() ?? 0) : nextId++;
    goals.set(id, { x: gx, y: gy, cls, tier: resolvedTier, refcount: 1 });
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
    goalByKey.delete(goalKey(goal.x, goal.y, goal.cls, goal.tier));
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
      if (goal === undefined) {
        return null;
      }
      return discreteDirAt(goalId, goal, x, y, scratch) === null ? null : scratch;
    },

    smoothDirectionAt(goalId, px, py) {
      const goal = goals.get(goalId);
      if (goal === undefined) {
        return null;
      }
      const cx = clearanceAnchorCell(px, goal.tier);
      const cy = clearanceAnchorCell(py, goal.tier);
      const field = discreteDirAt(goalId, goal, cx, cy, smoothScratch);
      if (field === null) {
        return null;
      }
      const d0x = smoothScratch.dx;
      const d0y = smoothScratch.dy;
      if (d0x === 0 && d0y === 0) {
        return smoothScratch;
      }
      const sector = sectorOfCell(terrain, cy * terrain.width + cx);
      const { x0, y0, x1, y1 } = sectorBounds(terrain, sector);
      const w = x1 - x0 + 1;

      // Stage 1: Intra-sector dual-quad bilinear gradient.
      const centerX = clearanceAnchorCenter(cx, goal.tier);
      const centerY = clearanceAnchorCenter(cy, goal.tier);
      const x00 = px >= centerX ? cx : cx - 1;
      const y00 = py >= centerY ? cy : cy - 1;
      if (x00 >= x0 && x00 + 1 <= x1 && y00 >= y0 && y00 + 1 <= y1) {
        const lx = x00 - x0;
        const ly = y00 - y0;
        const c00 = field.cost[ly * w + lx] ?? UNREACHABLE;
        const c10 = field.cost[ly * w + (lx + 1)] ?? UNREACHABLE;
        const c01 = field.cost[(ly + 1) * w + lx] ?? UNREACHABLE;
        const c11 = field.cost[(ly + 1) * w + (lx + 1)] ?? UNREACHABLE;
        if (
          c00 < UNREACHABLE &&
          c10 < UNREACHABLE &&
          c01 < UNREACHABLE &&
          c11 < UNREACHABLE &&
          quadPassableBothWays(terrain, x00, y00, goal.cls, goal.tier)
        ) {
          const tx = Math.max(0, Math.min(1, px - clearanceAnchorCenter(x00, goal.tier)));
          const ty = Math.max(0, Math.min(1, py - clearanceAnchorCenter(y00, goal.tier)));
          const gx = (1 - ty) * (c00 - c10) + ty * (c01 - c11);
          const gy = (1 - tx) * (c00 - c01) + tx * (c10 - c11);
          if (gx * d0x + gy * d0y > 0) {
            const len = Math.sqrt(gx * gx + gy * gy);
            if (len > 0) {
              smoothScratch.dx = gx / len;
              smoothScratch.dy = gy / len;
              return smoothScratch;
            }
          }
        }
      }

      // Stage 2: Intra-sector safe cardinal central difference.
      if (cx - 1 >= x0 && cx + 1 <= x1 && cy - 1 >= y0 && cy + 1 <= y1) {
        const lx = cx - x0;
        const ly = cy - y0;
        const cW = field.cost[ly * w + (lx - 1)] ?? UNREACHABLE;
        const cE = field.cost[ly * w + (lx + 1)] ?? UNREACHABLE;
        const cN = field.cost[(ly - 1) * w + lx] ?? UNREACHABLE;
        const cS = field.cost[(ly + 1) * w + lx] ?? UNREACHABLE;
        if (
          cW < UNREACHABLE &&
          cE < UNREACHABLE &&
          cN < UNREACHABLE &&
          cS < UNREACHABLE &&
          terrain.stepCost(cx, cy, cx - 1, cy, goal.cls, goal.tier) >= 0 &&
          terrain.stepCost(cx, cy, cx + 1, cy, goal.cls, goal.tier) >= 0 &&
          terrain.stepCost(cx, cy, cx, cy - 1, goal.cls, goal.tier) >= 0 &&
          terrain.stepCost(cx, cy, cx, cy + 1, goal.cls, goal.tier) >= 0
        ) {
          const gx = cW - cE;
          const gy = cN - cS;
          const sx = gx > 0 ? 1 : gx < 0 ? -1 : 0;
          const sy = gy > 0 ? 1 : gy < 0 ? -1 : 0;
          if (
            gx * d0x + gy * d0y > 0 &&
            (sx !== 0 || sy !== 0) &&
            terrain.stepCost(cx, cy, cx + sx, cy + sy, goal.cls, goal.tier) >= 0
          ) {
            const len = Math.sqrt(gx * gx + gy * gy);
            if (len > 0) {
              smoothScratch.dx = gx / len;
              smoothScratch.dy = gy / len;
              return smoothScratch;
            }
          }
        }
      }

      // Stage 3: Safe discrete unit fallback.
      const len = Math.sqrt(d0x * d0x + d0y * d0y);
      if (len > 0) {
        smoothScratch.dx = d0x / len;
        smoothScratch.dy = d0y / len;
      }
      return smoothScratch;
    },

    invalidateCells(cells) {
      for (let slot = 0; slot < graphs.length; slot++) {
        const clsGraph = graphs[slot];
        if (clsGraph !== undefined) {
          clsGraph.invalidate(cells);
          nodeIndexByCell[slot] = buildNodeIndex(clsGraph);
        }
      }
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
            .map(([id, g]) =>
              g.tier === CLEARANCE_STANDARD
                ? { id, x: g.x, y: g.y, cls: g.cls, ref: g.refcount }
                : { id, x: g.x, y: g.y, cls: g.cls, ref: g.refcount, tier: g.tier },
            );
          return { nextId, freeIds: [...freeIds], entries };
        },
        load(data: Serializable): void {
          const saved = data as {
            nextId: number;
            freeIds: number[];
            entries: {
              id: number;
              x: number;
              y: number;
              cls: number;
              ref: number;
              tier?: number;
            }[];
          };
          goals.clear();
          goalByKey.clear();
          freeIds.length = 0;
          freeIds.push(...saved.freeIds);
          nextId = saved.nextId;
          for (const entry of saved.entries) {
            const rawTier = entry.tier ?? CLEARANCE_STANDARD;
            const tier: ClearanceTier =
              rawTier === CLEARANCE_HEAVY ? CLEARANCE_HEAVY : CLEARANCE_STANDARD;
            goals.set(entry.id, {
              x: entry.x,
              y: entry.y,
              cls: entry.cls,
              tier,
              refcount: entry.ref,
            });
            goalByKey.set(goalKey(entry.x, entry.y, entry.cls, tier), entry.id);
          }
          // The blocked overlay may differ from construction time: rebuild
          // all class graphs and derived caches against the restored terrain.
          rebuildGraphs();
        },
      });
    },
  };
  return { module, api };
}
