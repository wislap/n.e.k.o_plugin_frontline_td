// Move/stop intent resolution and the MoveCommand handler — one shared
// applyMove path: release old goals, acquire one shared goal per class,
// write slot targets. Intents resolve at movement-phase start in
// emission order; a command additionally emits MoveOrdered (the player
// override signal squads listen to).
import type { EntityHandle, EntityId } from '../../../core/index';
import type { ComponentWriter, SimBuilder, SystemContext, WriteView } from '../../../kernel/index';
import type { ReadonlyNumberArray } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { spiralOffsets } from '../../terrain/rules/index';
import { MoveCommand, MoveIntent, MoveOrdered, StopIntent } from '../protocol';
import { Mover, MoveTarget, Position } from './components';
import { assignSlots, collectSlots } from './slots';

type TgtView = WriteView<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8' }>;
type TgtWriter = ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8' }>;

// Release only a goal this unit still owns: active===1 holds a live
// reference; active===2 (holding the slot) and active===0 already
// released theirs, so releasing their stale `goal` field would
// decrement a refcount they no longer own.
export function releaseHeldGoal(
  pathing: PathingApi,
  tgt: { goal: ReadonlyNumberArray; active: ReadonlyNumberArray },
  id: number,
): void {
  if ((tgt.active[id] ?? 0) === 1) {
    pathing.releaseGoal(tgt.goal[id] ?? 0);
  }
}

// A move intent at an impassable cell snaps to the nearest passable,
// reachable cell within this ring (spiral order, first hit wins).
const SNAP_RING = 32;

// Nearest cell for `cls` around (x, y) that is both passable and
// reachable from at least one moving unit (spiral order, first hit):
// used by move intents only — a structure's blocked centre must land
// the squad on the side it can actually walk to. Commands reject
// impassable targets instead.
function snapReachable(
  terrain: TerrainApi,
  pathing: PathingApi,
  pos: { x: ReadonlyNumberArray; y: ReadonlyNumberArray },
  cls: number,
  ids: readonly number[],
  x: number,
  y: number,
): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (const [dx, dy] of spiralOffsets(cx, cy, terrain.width, terrain.height)) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) > SNAP_RING) {
      break;
    }
    const tx = cx + dx;
    const ty = cy + dy;
    if (!terrain.passable(tx, ty, cls)) {
      continue;
    }
    const goal = pathing.acquireGoal(tx, ty, cls);
    const ok = ids.some(
      (id) =>
        pathing.directionAt(goal, Math.floor(pos.x[id] ?? 0), Math.floor(pos.y[id] ?? 0)) !== null,
    );
    pathing.releaseGoal(goal);
    if (ok) {
      return { x: tx, y: ty };
    }
  }
  return null;
}

// Shared goal/slot assignment used by MoveCommand and the move intent:
// release each unit's old goal, acquire one shared goal per class, then
// write slot targets. Callers have already validated the target cell.
function applyMove(
  ctx: SystemContext,
  terrain: TerrainApi,
  pathing: PathingApi,
  tgtW: TgtWriter,
  ids: readonly number[],
  x: number,
  y: number,
): void {
  const mover = ctx.read(Mover);
  const target = ctx.read(MoveTarget);
  const out = ctx.write(tgtW) as TgtView;
  const pos = ctx.read(Position);
  const classes = new Set<number>();
  for (const id of ids) {
    classes.add(mover.cls[id] ?? 0);
  }
  // One shared goal per movement class; each unit's slot keeps the
  // group's formation around the target.
  for (const cls of classes) {
    const clsIds = ids.filter((id) => (mover.cls[id] ?? 0) === cls);
    // Release old goals, then one shared-goal ref per unit (the goal
    // id is the same for the whole class).
    let goal = -1;
    for (const id of clsIds) {
      releaseHeldGoal(pathing, target, id);
      goal = pathing.acquireGoal(x, y, cls);
    }
    const slots = collectSlots(
      terrain,
      (sx, sy) => pathing.directionAt(goal, sx, sy) !== null,
      cls,
      x,
      y,
      clsIds.length,
    );
    const assignment = assignSlots(
      clsIds.map((id) => ({ id, x: pos.x[id] ?? 0, y: pos.y[id] ?? 0 })),
      slots,
    );
    for (const id of clsIds) {
      const slot = assignment.get(id) ?? { x: x + 0.5, y: y + 0.5 };
      out.goal[id] = goal;
      out.x[id] = slot.x;
      out.y[id] = slot.y;
      out.active[id] = 1;
    }
  }
}

export function installMovementIntents(
  builder: SimBuilder,
  terrain: TerrainApi,
  pathing: PathingApi,
  tgtW: TgtWriter,
): void {
  // Resolve move/stop intents first, in emission order; a later move
  // for the same unit overwrites the earlier one. Handle liveness
  // and Mover are validated; faction ownership is the emitter's
  // responsibility.
  builder.system({
    id: 'frontline_td:movement.intents',
    phase: 'movement',
    reads: [MoveIntent, StopIntent],
    run(ctx) {
      const mover = ctx.read(Mover);
      const target = ctx.read(MoveTarget);
      for (const p of ctx.read(MoveIntent)) {
        const ids: number[] = [];
        for (const h of p.units) {
          const id = ctx.resolve(h as EntityHandle);
          if (id !== null && ctx.has(Mover, id) && !ids.includes(id)) {
            ids.push(id);
          }
        }
        if (ids.length === 0 || !terrain.inBounds(p.x, p.y)) {
          continue;
        }
        // Per-class: an impassable target cell snaps to the nearest
        // passable cell the group can reach for that class (intents
        // aim at points — e.g. a structure's blocked centre);
        // commands instead reject impassable targets outright.
        const byClass = new Map<number, number[]>();
        for (const id of ids) {
          const cls = mover.cls[id] ?? 0;
          const list = byClass.get(cls);
          if (list === undefined) {
            byClass.set(cls, [id]);
          } else {
            list.push(id);
          }
        }
        const pos = ctx.read(Position);
        for (const [cls, clsIds] of byClass) {
          const point = terrain.passable(p.x, p.y, cls)
            ? { x: p.x, y: p.y }
            : snapReachable(terrain, pathing, pos, cls, clsIds, p.x, p.y);
          if (point !== null) {
            applyMove(ctx, terrain, pathing, tgtW, clsIds, point.x, point.y);
          }
        }
      }
      for (const p of ctx.read(StopIntent)) {
        for (const h of p.units) {
          const id = ctx.resolve(h as EntityHandle);
          if (id === null || !ctx.has(Mover, id)) {
            continue;
          }
          releaseHeldGoal(pathing, target, id);
          const out = ctx.write(tgtW) as TgtView;
          out.goal[id] = 0;
          out.active[id] = 0;
        }
      }
    },
  });

  builder.command(
    MoveCommand,
    (ctx, payload, issuer) => {
      if (!terrain.inBounds(payload.x, payload.y)) {
        ctx.reject('invalid_target');
        return;
      }
      // Validate before mutating: a mid-loop reject must not leave earlier
      // units with acquired goals or a half-applied order.
      const mover = ctx.read(Mover);
      const ids: number[] = [];
      const classes = new Set<number>();
      for (const handle of payload.units) {
        const id = ctx.resolve(handle);
        if (
          id === null ||
          !ctx.ownedBy(handle, issuer) ||
          !ctx.has(Mover, id) ||
          ids.includes(id)
        ) {
          continue;
        }
        ids.push(id);
        classes.add(mover.cls[id] ?? 0);
      }
      if (ids.length === 0) {
        ctx.reject('no_units');
        return;
      }
      for (const cls of classes) {
        if (!terrain.passable(payload.x, payload.y, cls)) {
          ctx.reject('invalid_target');
          return;
        }
      }
      applyMove(ctx, terrain, pathing, tgtW, ids, payload.x, payload.y);
      // Player override signal (squads drop these members): only the
      // command emits this; intent-driven moves do not.
      ctx.emit(MoveOrdered, { units: ids.map((id) => Number(ctx.handleOf(id as EntityId))) });
    },
    { emits: [MoveOrdered] },
  );
}
