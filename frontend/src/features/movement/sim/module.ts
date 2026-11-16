// Movement systems (design §7.3): steer along the pathing flow field,
// uniform-grid separation, then integrate with passability checks. The
// spatial hash is movement-internal until combat needs it (M3).
import type {
  ComponentWriter,
  SimModule,
  SpawnInit,
  SystemContext,
  WriteView,
} from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { MoveCommand } from '../protocol';
import { MoveTarget, Mover, Position, Velocity } from './components';
import { lineWalkable } from './line';
import { assignSlots, collectSlots } from './slots';

// Separation bucket size in cells.
const BUCKET = 2;
// Extra breathing room between units on top of both radii. Adjacent slot
// cells are 1 apart, so 0.35+0.35+0.2 still fits.
export const SEPARATION_GAP = 0.2;
// A unit has arrived when this close to its slot point.
const ARRIVAL_DIST = 0.3;
// Within this distance a unit may steer straight at its slot when the cell
// line is walkable (skips flow-field detours next to the goal).
const DIRECT_DIST = 8;
// Fixed neighbour-bucket order for pair iteration (deterministic).
const NB_ORDER = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

// Spawn tuples for a movable entity: callers add Faction/InWorld/UnitKind.
export function moverComponents(
  x: number,
  y: number,
  speed: number,
  radius: number,
  cls: number,
): SpawnInit {
  return [
    [Position, { x, y }],
    [Velocity, { x: 0, y: 0 }],
    [Mover, { speed, radius, cls }],
    [MoveTarget, { goal: 0, x: 0, y: 0, active: 0 }],
  ];
}

type VelView = WriteView<{ x: 'f64'; y: 'f64' }>;
type TgtView = WriteView<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8' }>;

// Release the shared goal and hold the slot: the unit steers back to its
// slot point if separation later pushes it off.
function holdUnit(pathing: PathingApi, vel: VelView, tgt: TgtView, id: number): void {
  pathing.releaseGoal(tgt.goal[id] ?? 0);
  tgt.active[id] = 2;
  vel.x[id] = 0;
  vel.y[id] = 0;
}

// Release the shared goal and stop the unit for good (unreachable target).
function stopUnit(pathing: PathingApi, vel: VelView, tgt: TgtView, id: number): void {
  pathing.releaseGoal(tgt.goal[id] ?? 0);
  tgt.active[id] = 0;
  vel.x[id] = 0;
  vel.y[id] = 0;
}

// Same-cell moves are always fine; stepCost only rates cell crossings.
function canStep(
  terrain: TerrainApi,
  cls: number,
  ccx: number,
  ccy: number,
  tx: number,
  ty: number,
): boolean {
  const tcx = Math.floor(tx);
  const tcy = Math.floor(ty);
  return (tcx === ccx && tcy === ccy) || terrain.stepCost(ccx, ccy, tcx, tcy, cls) >= 0;
}

export function createMovementModule(terrain: TerrainApi, pathing: PathingApi): SimModule {
  let velW: ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  let posW: ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  let tgtW: ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8' }>;

  // Reused every tick: bucket key -> slot indices into the query result
  // (ascending id order, since the query returns sorted ids and buckets are
  // filled in that order). Arrays are emptied, never reallocated.
  const buckets = new Map<number, number[]>();
  let pushX = new Float64Array(64);
  let pushY = new Float64Array(64);
  const bucketCols = Math.ceil(terrain.width / BUCKET);

  function bucketOf(cx: number, cy: number): number {
    const bx = Math.min(Math.floor(cx / BUCKET), bucketCols - 1);
    const by = Math.floor(cy / BUCKET);
    return by * bucketCols + bx;
  }

  function steer(ctx: SystemContext): void {
    const pos = ctx.read(Position);
    const mover = ctx.read(Mover);
    const target = ctx.read(MoveTarget);
    const vel = ctx.write(velW);
    const tgt = ctx.write(tgtW);
    const ids = ctx.query([Position, Mover, MoveTarget]);
    for (const id of ids) {
      const active = target.active[id] ?? 0;
      const px = pos.x[id] ?? 0;
      const py = pos.y[id] ?? 0;
      const tx = target.x[id] ?? 0;
      const ty = target.y[id] ?? 0;
      const dx = tx - px;
      const dy = ty - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (active === 0) {
        vel.x[id] = 0;
        vel.y[id] = 0;
        continue;
      }
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      let dirX: number;
      let dirY: number;
      if (active === 2) {
        // Holding the slot: steer straight back when pushed off it.
        if (dist <= ARRIVAL_DIST) {
          vel.x[id] = 0;
          vel.y[id] = 0;
          continue;
        }
        dirX = dx;
        dirY = dy;
      } else {
        if (dist <= ARRIVAL_DIST) {
          holdUnit(pathing, vel, tgt, id);
          continue;
        }
        if (dist <= DIRECT_DIST && lineWalkable(terrain, mover.cls[id] ?? 0, px, py, tx, ty)) {
          // Close enough and a legal straight line: go straight at the slot.
          dirX = dx;
          dirY = dy;
        } else {
          const flow = pathing.directionAt(target.goal[id] ?? 0, cx, cy);
          if (flow === null) {
            // Unreachable: give up and stop in place.
            stopUnit(pathing, vel, tgt, id);
            continue;
          }
          if (flow.dx === 0 && flow.dy === 0) {
            // On the goal cell: steer straight at the slot.
            dirX = dx;
            dirY = dy;
          } else {
            dirX = flow.dx;
            dirY = flow.dy;
          }
        }
      }
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len <= 0) {
        vel.x[id] = 0;
        vel.y[id] = 0;
        continue;
      }
      const speed = (mover.speed[id] ?? 0) * (terrain.speedBpAt(cx, cy) / 10000);
      vel.x[id] = (dirX / len) * speed;
      vel.y[id] = (dirY / len) * speed;
    }
  }

  function separate(ctx: SystemContext): void {
    const ids = ctx.query([Position, Mover]);
    const pos = ctx.read(Position);
    const mover = ctx.read(Mover);
    if (pushX.length < ids.length) {
      pushX = new Float64Array(ids.length * 2);
      pushY = new Float64Array(ids.length * 2);
    }
    pushX.fill(0, 0, ids.length);
    pushY.fill(0, 0, ids.length);
    for (const list of buckets.values()) {
      list.length = 0;
    }
    for (let slot = 0; slot < ids.length; slot++) {
      const id = ids[slot] ?? 0;
      const key = bucketOf(pos.x[id] ?? 0, pos.y[id] ?? 0);
      let list = buckets.get(key);
      if (list === undefined) {
        list = [];
        buckets.set(key, list);
      }
      list.push(slot);
    }
    for (let slot = 0; slot < ids.length; slot++) {
      const a = ids[slot] ?? 0;
      const ax = pos.x[a] ?? 0;
      const ay = pos.y[a] ?? 0;
      const ar = mover.radius[a] ?? 0;
      const bx = Math.floor(ax / BUCKET);
      const by = Math.floor(ay / BUCKET);
      for (const [dx, dy] of NB_ORDER) {
        const list = buckets.get((by + dy) * bucketCols + bx + dx);
        if (list === undefined) {
          continue;
        }
        for (const other of list) {
          if (other <= slot) {
            continue;
          }
          const b = ids[other] ?? 0;
          const ddx = (pos.x[b] ?? 0) - ax;
          const ddy = (pos.y[b] ?? 0) - ay;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const overlap = ar + (mover.radius[b] ?? 0) + SEPARATION_GAP - dist;
          if (overlap <= 0) {
            continue;
          }
          let ux: number;
          let uy: number;
          if (dist > 0) {
            ux = ddx / dist;
            uy = ddy / dist;
          } else {
            // Coincident: deterministic axis from id parity.
            ux = (a + b) % 2 === 0 ? 1 : 0;
            uy = 1 - ux;
          }
          const push = overlap * 0.5;
          pushX[slot] = (pushX[slot] ?? 0) - ux * push;
          pushY[slot] = (pushY[slot] ?? 0) - uy * push;
          pushX[other] = (pushX[other] ?? 0) + ux * push;
          pushY[other] = (pushY[other] ?? 0) + uy * push;
        }
      }
    }
    // Pushes ride on Velocity so integrate applies the passability fallback;
    // steer zeroes velocity for idle units each tick, so it never accumulates.
    const vel = ctx.write(velW);
    for (let slot = 0; slot < ids.length; slot++) {
      const id = ids[slot] ?? 0;
      vel.x[id] = (vel.x[id] ?? 0) + (pushX[slot] ?? 0);
      vel.y[id] = (vel.y[id] ?? 0) + (pushY[slot] ?? 0);
    }
  }

  function integrate(ctx: SystemContext): void {
    const ids = ctx.query([Position, Velocity, Mover]);
    const pos = ctx.read(Position);
    const vel = ctx.read(Velocity);
    const mover = ctx.read(Mover);
    const out = ctx.write(posW);
    const maxX = terrain.width - 1e-9;
    const maxY = terrain.height - 1e-9;
    for (const id of ids) {
      const px = pos.x[id] ?? 0;
      const py = pos.y[id] ?? 0;
      const cls = mover.cls[id] ?? 0;
      const ccx = Math.floor(px);
      const ccy = Math.floor(py);
      let nx = px + (vel.x[id] ?? 0);
      let ny = py + (vel.y[id] ?? 0);
      if (!canStep(terrain, cls, ccx, ccy, nx, ny)) {
        if (canStep(terrain, cls, ccx, ccy, nx, py)) {
          ny = py;
        } else if (canStep(terrain, cls, ccx, ccy, px, ny)) {
          nx = px;
        } else {
          nx = px;
          ny = py;
        }
      }
      out.x[id] = Math.min(Math.max(nx, 0), maxX);
      out.y[id] = Math.min(Math.max(ny, 0), maxY);
    }
  }

  return {
    id: 'frontline_td:movement',
    install(builder) {
      velW = builder.claimWriter(Velocity);
      posW = builder.claimWriter(Position);
      tgtW = builder.claimWriter(MoveTarget);

      builder.system({ id: 'frontline_td:movement.steer', phase: 'movement', run: steer });
      builder.system({ id: 'frontline_td:movement.separate', phase: 'movement', run: separate });
      builder.system({ id: 'frontline_td:movement.integrate', phase: 'movement', run: integrate });

      builder.command(MoveCommand, (ctx, payload, issuer) => {
        if (!terrain.inBounds(payload.x, payload.y)) {
          ctx.reject('invalid_target');
          return;
        }
        // Validate before mutating: a mid-loop reject must not leave earlier
        // units with acquired goals or a half-applied order.
        const mover = ctx.read(Mover);
        const target = ctx.read(MoveTarget);
        const ids: number[] = [];
        const classes = new Set<number>();
        for (const handle of payload.units) {
          const id = ctx.resolve(handle);
          if (id === null || !ctx.ownedBy(handle, issuer) || !ctx.has(Mover, id)) {
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
        const out = ctx.write(tgtW);
        const pos = ctx.read(Position);
        // One shared goal per movement class; each unit's slot keeps the
        // group's formation around the target.
        for (const cls of classes) {
          const clsIds = ids.filter((id) => (mover.cls[id] ?? 0) === cls);
          // Release old goals, then one shared-goal ref per unit (the goal
          // id is the same for the whole class).
          let goal = -1;
          for (const id of clsIds) {
            if ((target.active[id] ?? 0) !== 0) {
              pathing.releaseGoal(target.goal[id] ?? 0);
            }
            goal = pathing.acquireGoal(payload.x, payload.y, cls);
          }
          const slots = collectSlots(
            terrain,
            (x, y) => pathing.directionAt(goal, x, y) !== null,
            cls,
            payload.x,
            payload.y,
            clsIds.length,
          );
          const assignment = assignSlots(
            clsIds.map((id) => ({ id, x: pos.x[id] ?? 0, y: pos.y[id] ?? 0 })),
            slots,
          );
          for (const id of clsIds) {
            const slot = assignment.get(id) ?? { x: payload.x + 0.5, y: payload.y + 0.5 };
            out.goal[id] = goal;
            out.x[id] = slot.x;
            out.y[id] = slot.y;
            out.active[id] = 1;
          }
        }
      });
    },
  };
}
