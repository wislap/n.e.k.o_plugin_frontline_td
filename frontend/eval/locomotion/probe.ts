import type { EntityId } from '../../src/core/index';
import { CombatShot } from '../../src/features/combat/protocol';
import { Mover, MoveTarget, Position } from '../../src/features/movement/sim/index';
import {
  clearanceAnchorCell,
  clearanceTierForRadius,
} from '../../src/features/terrain/rules/index';
import type { TerrainApi } from '../../src/features/terrain/sim/index';
import { Faction, InWorld } from '../../src/kernel/index';
import type { SimModule, SystemContext } from '../../src/kernel/index';
import type { DynamicBlockerEvent, ProbeRecording, RecordedUnit } from './types';

interface InitialUnitInfo {
  readonly handle: number;
  readonly id: EntityId;
  readonly faction: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxSpeed: number;
}

interface LocomotionProbe {
  readonly module: SimModule;
  initialUnits(): readonly InitialUnitInfo[];
  setGroup(handle: number, group: number): void;
  setRange(handle: number, range: number): void;
  recordBlockerChange(tick: number, cells: readonly { x: number; y: number }[]): void;
  finalize(): ProbeRecording;
}

interface MutableUnitRecord {
  readonly handle: number;
  group: number;
  readonly faction: number;
  readonly radius: number;
  readonly maxSpeed: number;
  range: number;
  firstTick: number;
  lastTick: number;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly actives: Uint8Array;
  readonly shotTicks: number[];
  wallScrapeTicks: number;
}

function isNearImpassableWall(
  terrain: TerrainApi,
  cls: number,
  px: number,
  py: number,
  radius: number,
): boolean {
  const tier = clearanceTierForRadius(radius);
  const cx = clearanceAnchorCell(px, tier);
  const cy = clearanceAnchorCell(py, tier);
  const probeDist = radius + 0.36;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (terrain.inBounds(nx, ny) && terrain.stepCost(cx, cy, nx, ny, cls, tier) >= 0) {
        continue;
      }
      const minX = nx;
      const maxX = nx + 1;
      const minY = ny;
      const maxY = ny + 1;
      const nearX = Math.max(minX, Math.min(px, maxX));
      const nearY = Math.max(minY, Math.min(py, maxY));
      const ddx = px - nearX;
      const ddy = py - nearY;
      if (ddx * ddx + ddy * ddy <= probeDist * probeDist) {
        return true;
      }
    }
  }
  return false;
}

export function createLocomotionProbe(terrain: TerrainApi, totalTicks: number): LocomotionProbe {
  const records = new Map<number, MutableUnitRecord>();
  const groupOverrides = new Map<number, number>();
  const rangeOverrides = new Map<number, number>();
  const initial: InitialUnitInfo[] = [];
  const perTickCoreOverlap = new Float64Array(totalTicks);
  const dynamicBlockers: DynamicBlockerEvent[] = [];

  function runProbe(ctx: SystemContext): void {
    const t = ctx.tick as number;
    if (t < 0 || t >= totalTicks) {
      return;
    }

    const pos = ctx.read(Position);
    const mover = ctx.read(Mover);
    const tgt = ctx.read(MoveTarget);
    const fac = ctx.read(Faction);
    const ids = ctx.query([Position, Mover, MoveTarget, Faction, InWorld]);
    const n = ids.length;

    const snapX = new Float64Array(n);
    const snapY = new Float64Array(n);
    const snapR = new Float64Array(n);
    const snapHandles = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const id = ids[i] as EntityId;
      const handle = Number(ctx.handleOf(id) ?? 0);
      const px = pos.x[id] ?? 0;
      const py = pos.y[id] ?? 0;
      const radius = mover.radius[id] ?? 0;
      const maxSpeed = mover.speed[id] ?? 0;
      const faction = fac.id[id] ?? 0;
      const active = tgt.active[id] ?? 0;
      const cls = mover.cls[id] ?? 0;

      snapX[i] = px;
      snapY[i] = py;
      snapR[i] = radius;
      snapHandles[i] = handle;

      if (t === 0) {
        initial.push({ handle, id, faction, x: px, y: py, radius, maxSpeed });
      }

      let rec = records.get(handle);
      if (rec === undefined) {
        rec = {
          handle,
          group: groupOverrides.get(handle) ?? 1,
          faction,
          radius,
          maxSpeed,
          range: rangeOverrides.get(handle) ?? 0,
          firstTick: t,
          lastTick: t,
          xs: new Float32Array(totalTicks),
          ys: new Float32Array(totalTicks),
          actives: new Uint8Array(totalTicks),
          shotTicks: [],
          wallScrapeTicks: 0,
        };
        records.set(handle, rec);
      }

      rec.xs[t] = px;
      rec.ys[t] = py;
      rec.actives[t] = active;
      rec.lastTick = t;

      if (t > rec.firstTick && active === 1) {
        const prevX = rec.xs[t - 1] ?? px;
        const prevY = rec.ys[t - 1] ?? py;
        const stepLen = Math.hypot(px - prevX, py - prevY);
        const cx = Math.min(terrain.width - 1, Math.max(0, Math.floor(px)));
        const cy = Math.min(terrain.height - 1, Math.max(0, Math.floor(py)));
        const localMax = maxSpeed * (terrain.speedBpAt(cx, cy) / 10000);
        if (stepLen < 0.45 * localMax && isNearImpassableWall(terrain, cls, px, py, radius)) {
          let blockedByUnit = false;
          for (let j = 0; j < n; j++) {
            if (i === j) {
              continue;
            }
            const oHandle = snapHandles[j] ?? 0;
            if (oHandle === handle) {
              continue;
            }
            const ox = j < i ? (snapX[j] ?? 0) : (pos.x[ids[j] as EntityId] ?? 0);
            const oy = j < i ? (snapY[j] ?? 0) : (pos.y[ids[j] as EntityId] ?? 0);
            const or = j < i ? (snapR[j] ?? 0) : (mover.radius[ids[j] as EntityId] ?? 0);
            const limit = radius + or + 0.15;
            const ddx = ox - px;
            const ddy = oy - py;
            if (ddx * ddx + ddy * ddy <= limit * limit) {
              blockedByUnit = true;
              break;
            }
          }
          if (!blockedByUnit) {
            rec.wallScrapeTicks += 1;
          }
        }
      }
    }

    let coreOverlapSum = 0;
    for (let i = 0; i < n; i++) {
      const ax = snapX[i] ?? 0;
      const ay = snapY[i] ?? 0;
      const ar = snapR[i] ?? 0;
      for (let j = i + 1; j < n; j++) {
        const bx = snapX[j] ?? 0;
        const by = snapY[j] ?? 0;
        const br = snapR[j] ?? 0;
        const sumR = ar + br;
        const ddx = bx - ax;
        const ddy = by - ay;
        if (Math.abs(ddx) >= sumR || Math.abs(ddy) >= sumR) {
          continue;
        }
        const dist = Math.hypot(ddx, ddy);
        if (dist < sumR) {
          coreOverlapSum += sumR - dist;
        }
      }
    }
    perTickCoreOverlap[t] = coreOverlapSum;

    for (const shot of ctx.read(CombatShot)) {
      const rec = records.get(shot.from);
      if (rec !== undefined) {
        rec.shotTicks.push(t);
      }
    }
  }

  return {
    module: {
      id: 'frontline_td:eval.locomotion_probe',
      install(builder) {
        builder.system({
          id: 'frontline_td:eval.locomotion_probe.sample',
          phase: 'cleanup',
          reads: [CombatShot],
          run: runProbe,
        });
      },
    },
    initialUnits() {
      return initial;
    },
    setGroup(handle, group) {
      groupOverrides.set(handle, group);
      const rec = records.get(handle);
      if (rec !== undefined) {
        rec.group = group;
      }
    },
    setRange(handle, range) {
      rangeOverrides.set(handle, range);
      const rec = records.get(handle);
      if (rec !== undefined) {
        rec.range = range;
      }
    },
    recordBlockerChange(tick, cells) {
      dynamicBlockers.push({ tick, cells: cells.map((c) => ({ ...c })) });
    },
    finalize(): ProbeRecording {
      const units: RecordedUnit[] = [...records.values()].sort((a, b) => a.handle - b.handle);
      return {
        ticks: totalTicks,
        units,
        perTickCoreOverlap,
        dynamicBlockers,
      };
    },
  };
}
