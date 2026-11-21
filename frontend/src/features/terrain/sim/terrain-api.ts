// Read-only queries over a decoded TerrainGrid plus the resolved surface
// table, and the dynamic blocker overlay (M3: buildings mark cells blocked;
// passability stays terrain's public concept). All query methods are
// allocation-free — this is the hot path for pathing and movement.
import { floorDiv } from '../../../core/index';
import type { Serializable } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  type ClearanceTier,
  heightStepPassable,
} from '../rules/index';
import type { TerrainGrid } from '../content';

export interface TerrainApi {
  readonly width: number;
  readonly height: number;
  inBounds(x: number, y: number): boolean;
  heightAt(x: number, y: number): number;
  // Surface registry index at the cell.
  surfaceAt(x: number, y: number): number;
  // Deposit cargo index on the cell's surface, -1 when none.
  depositAt(x: number, y: number): number;
  // True on ramp cells (the only legal height transitions).
  isRamp(x: number, y: number): boolean;
  passable(x: number, y: number, cls: number, tier?: ClearanceTier): boolean;
  // Static passability ignoring the dynamic blocked overlay (placement
  // rules distinguish 'terrain' from 'occupied').
  staticPassable(x: number, y: number, cls: number, tier?: ClearanceTier): boolean;
  // Integer step cost from (ax,ay) to (bx,by) for movement-class index cls;
  // -1 when the step is not allowed.
  stepCost(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cls: number,
    tier?: ClearanceTier,
  ): number;
  speedBpAt(x: number, y: number): number;
  // Dynamic blocker overlay: blocked cells are impassable for every class.
  blocked(x: number, y: number): boolean;
  setBlocked(cells: readonly { x: number; y: number }[], value: boolean): void;
  // Wiring-time subscription (pathing registers invalidateCells); called
  // synchronously from setBlocked with the cells that actually changed
  // and the value they were set to.
  onBlockedChange(
    listener: (cells: readonly { x: number; y: number }[], blocked: boolean) => void,
  ): void;
}

// Module-facing serialization/mirror hooks for the overlay; the terrain
// module persists it via builder.state and mirrors it into the blocked layer.
export interface TerrainBlockedStore {
  save(): Uint8Array;
  load(data: Serializable): void;
  // True once after each setBlocked that changed the overlay (load does not
  // set it: the layer is restored from the save itself).
  takeDirty(): boolean;
}

const DIAGONAL_SCALE_NUM = 14;
const DIAGONAL_SCALE_DEN = 10;

function buildApi(
  grid: TerrainGrid,
  surfaces: readonly ResolvedSurface[],
): { api: TerrainApi; store: TerrainBlockedStore } {
  const { width, height } = grid;
  const blockedCells = new Uint8Array(width * height);
  const listeners: ((cells: readonly { x: number; y: number }[], blocked: boolean) => void)[] = [];
  let dirty = false;

  function idx(x: number, y: number): number {
    return y * width + x;
  }

  function inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < width && y < height;
  }

  function blockedAt(x: number, y: number): boolean {
    return blockedCells[idx(x, y)] === 1;
  }

  function costAt(x: number, y: number, cls: number): number {
    const surface = surfaces[grid.surfaces[idx(x, y)] ?? 0];
    return surface?.costs[cls] ?? -1;
  }

  function staticEdgePassable(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cls: number,
  ): boolean {
    if (costAt(ax, ay, cls) < 0 || costAt(bx, by, cls) < 0) {
      return false;
    }
    return heightStepPassable(
      grid.heights[idx(ax, ay)] ?? 0,
      grid.heights[idx(bx, by)] ?? 0,
      grid.ramps[idx(ax, ay)] ?? 0,
      grid.ramps[idx(bx, by)] ?? 0,
    );
  }

  function edgePassable(ax: number, ay: number, bx: number, by: number, cls: number): boolean {
    if (blockedAt(ax, ay) || blockedAt(bx, by)) {
      return false;
    }
    return staticEdgePassable(ax, ay, bx, by, cls);
  }

  function passableHeavy(x: number, y: number, cls: number): boolean {
    if (!inBounds(x, y) || !inBounds(x + 1, y + 1)) {
      return false;
    }
    return (
      edgePassable(x, y, x + 1, y, cls) &&
      edgePassable(x, y, x, y + 1, cls) &&
      edgePassable(x + 1, y, x + 1, y + 1, cls) &&
      edgePassable(x, y + 1, x + 1, y + 1, cls)
    );
  }

  function staticPassableHeavy(x: number, y: number, cls: number): boolean {
    if (!inBounds(x, y) || !inBounds(x + 1, y + 1)) {
      return false;
    }
    return (
      staticEdgePassable(x, y, x + 1, y, cls) &&
      staticEdgePassable(x, y, x, y + 1, cls) &&
      staticEdgePassable(x + 1, y, x + 1, y + 1, cls) &&
      staticEdgePassable(x, y + 1, x + 1, y + 1, cls)
    );
  }

  function stepCost0(ax: number, ay: number, bx: number, by: number, cls: number): number {
    if (ax === bx && ay === by) {
      return -1;
    }
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    if (dx > 1 || dy > 1) {
      return -1;
    }
    if (!inBounds(ax, ay) || !inBounds(bx, by)) {
      return -1;
    }
    if (!edgePassable(ax, ay, bx, by, cls)) {
      return -1;
    }
    const cost = costAt(bx, by, cls);
    if (dx === 1 && dy === 1) {
      // No corner cutting: both orthogonal legs must be passable.
      if (!edgePassable(ax, ay, bx, ay, cls) || !edgePassable(ax, ay, ax, by, cls)) {
        return -1;
      }
      return floorDiv(cost * DIAGONAL_SCALE_NUM, DIAGONAL_SCALE_DEN);
    }
    return cost;
  }

  function stepCostHeavy(ax: number, ay: number, bx: number, by: number, cls: number): number {
    if (ax === bx && ay === by) {
      return -1;
    }
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    if (dx > 1 || dy > 1) {
      return -1;
    }
    if (!passableHeavy(ax, ay, cls) || !passableHeavy(bx, by, cls)) {
      return -1;
    }
    if (dx === 1 && dy === 1 && (!passableHeavy(bx, ay, cls) || !passableHeavy(ax, by, cls))) {
      return -1;
    }
    const c00 = stepCost0(ax, ay, bx, by, cls);
    if (c00 < 0) {
      return -1;
    }
    const c10 = stepCost0(ax + 1, ay, bx + 1, by, cls);
    if (c10 < 0) {
      return -1;
    }
    const c01 = stepCost0(ax, ay + 1, bx, by + 1, cls);
    if (c01 < 0) {
      return -1;
    }
    const c11 = stepCost0(ax + 1, ay + 1, bx + 1, by + 1, cls);
    if (c11 < 0) {
      return -1;
    }
    return Math.max(c00, c10, c01, c11);
  }

  const api: TerrainApi = {
    width,
    height,

    inBounds,
    heightAt(x, y) {
      return grid.heights[idx(x, y)] ?? 0;
    },
    surfaceAt(x, y) {
      return grid.surfaces[idx(x, y)] ?? 0;
    },
    depositAt(x, y) {
      const surface = surfaces[grid.surfaces[idx(x, y)] ?? 0];
      return surface?.deposit ?? -1;
    },
    isRamp(x, y) {
      return inBounds(x, y) && (grid.ramps[idx(x, y)] ?? 0) !== 0;
    },
    passable(x, y, cls, tier = CLEARANCE_STANDARD) {
      if (tier === CLEARANCE_HEAVY) {
        return passableHeavy(x, y, cls);
      }
      return inBounds(x, y) && !blockedAt(x, y) && costAt(x, y, cls) >= 0;
    },
    staticPassable(x, y, cls, tier = CLEARANCE_STANDARD) {
      if (tier === CLEARANCE_HEAVY) {
        return staticPassableHeavy(x, y, cls);
      }
      return inBounds(x, y) && costAt(x, y, cls) >= 0;
    },
    stepCost(ax, ay, bx, by, cls, tier = CLEARANCE_STANDARD) {
      if (tier === CLEARANCE_HEAVY) {
        return stepCostHeavy(ax, ay, bx, by, cls);
      }
      return stepCost0(ax, ay, bx, by, cls);
    },
    speedBpAt(x, y) {
      const surface = surfaces[grid.surfaces[idx(x, y)] ?? 0];
      return surface?.speedBp ?? 0;
    },
    blocked(x, y) {
      return inBounds(x, y) && blockedAt(x, y);
    },
    setBlocked(cells, value) {
      const changed: { x: number; y: number }[] = [];
      const next = value ? 1 : 0;
      for (const cell of cells) {
        if (!inBounds(cell.x, cell.y)) {
          continue;
        }
        const index = idx(cell.x, cell.y);
        if (blockedCells[index] !== next) {
          blockedCells[index] = next;
          changed.push({ x: cell.x, y: cell.y });
        }
      }
      if (changed.length === 0) {
        return;
      }
      dirty = true;
      for (const listener of listeners) {
        listener(changed, value);
      }
    },
    onBlockedChange(listener) {
      listeners.push(listener);
    },
  };

  const store: TerrainBlockedStore = {
    save() {
      return blockedCells.slice();
    },
    load(data) {
      // No dirty flag: the blocked layer is itself restored from the save,
      // so remirroring would only mark a spurious changedLayers entry and
      // diverge the hash from an uninterrupted run.
      blockedCells.set(data as Uint8Array);
    },
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
  };
  return { api, store };
}

export function createTerrainApi(
  grid: TerrainGrid,
  surfaces: readonly ResolvedSurface[],
): TerrainApi {
  return buildApi(grid, surfaces).api;
}

// The module variant additionally exposes the overlay's serialization/mirror
// hooks; plain createTerrainApi callers get the same api without the store.
export function createTerrainApiWithStore(
  grid: TerrainGrid,
  surfaces: readonly ResolvedSurface[],
): { api: TerrainApi; blocked: TerrainBlockedStore } {
  const built = buildApi(grid, surfaces);
  return { api: built.api, blocked: built.store };
}
