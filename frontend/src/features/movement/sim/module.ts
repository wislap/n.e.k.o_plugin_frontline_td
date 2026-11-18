// Movement systems (design §7.3): steer along the pathing flow field,
// uniform-grid separation, then integrate with passability checks. The
// spatial hash is movement-internal until combat needs it (M3).
import type { EntityHandle, EntityId } from '../../../core/index';
import { CombatDied } from '../../combat/protocol';
import type {
  ComponentWriter,
  SimModule,
  SpawnInit,
  SystemContext,
  WriteView,
} from '../../../kernel/index';
import { defineStat } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { MoveTarget, Mover, Position, Velocity } from './components';
import { installMovementIntents, releaseHeldGoal } from './intents';
import { lineWalkable } from './line';
import { makeSeparate } from './separate';

// The movement speed stat: logistics' energy modifiers multiply it (ADR
// 0025). With no modifiers stat() returns the base unchanged.
export const MoveSpeed = defineStat('frontline_td:movement.speed');

// A unit has arrived when this close to its slot point.
const ARRIVAL_DIST = 0.3;
// Within this distance a unit may steer straight at its slot when the cell
// line is walkable (skips flow-field detours next to the goal).
const DIRECT_DIST = 8;

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
  releaseHeldGoal(pathing, tgt, id);
  tgt.active[id] = 2;
  vel.x[id] = 0;
  vel.y[id] = 0;
}

// Release the shared goal and stop the unit for good (unreachable target).
function stopUnit(pathing: PathingApi, vel: VelView, tgt: TgtView, id: number): void {
  releaseHeldGoal(pathing, tgt, id);
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
  const separate = makeSeparate(terrain, () => velW);

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
      const speed =
        ctx.stat(MoveSpeed, id as EntityId, mover.speed[id] ?? 0) *
        (terrain.speedBpAt(cx, cy) / 10000);
      vel.x[id] = (dirX / len) * speed;
      vel.y[id] = (dirY / len) * speed;
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

      installMovementIntents(builder, terrain, pathing, tgtW);

      builder.system({ id: 'frontline_td:movement.steer', phase: 'movement', run: steer });
      builder.system({ id: 'frontline_td:movement.separate', phase: 'movement', run: separate });
      builder.system({ id: 'frontline_td:movement.integrate', phase: 'movement', run: integrate });

      // Dead movers release their shared goal in the same cleanup phase,
      // before combat's despawn runs — module order fixes the structural
      // queue (despawn order is observable through entity-id reuse).
      // Only active===1 still owns a goal: hold/stop already released.
      builder.system({
        id: 'frontline_td:movement.release_dead',
        phase: 'cleanup',
        reads: [CombatDied],
        run(ctx) {
          const target = ctx.read(MoveTarget);
          const out = ctx.write(tgtW);
          for (const p of ctx.read(CombatDied)) {
            const id = ctx.resolve(p.handle as EntityHandle);
            if (id === null || !ctx.has(Mover, id)) {
              continue;
            }
            releaseHeldGoal(pathing, target, id);
            out.goal[id] = 0;
            out.active[id] = 0;
          }
        },
      });
    },
  };
}
