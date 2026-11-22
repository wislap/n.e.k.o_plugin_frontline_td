// Movement systems (design §7.3): steer along the pathing flow field,
// uniform-grid separation, then integrate with passability checks. The
// spatial hash is movement-internal until combat needs it (M3).
import type { EntityHandle, EntityId, Serializable } from '../../../core/index';
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
import {
  CLEARANCE_HEAVY,
  clearanceAnchorCell,
  clearanceFootprintSize,
  clearanceTierForRadius,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { FormationGuide, MoveTarget, Mover, Position, RouteFollow, Velocity } from './components';
import { clearFormationGuide, installMovementIntents, releaseHeldGoal } from './intents';
import { canStep, lineWalkable } from './line';
import {
  boundedLocalRejoin,
  createRouteChainStore,
  releaseRouteFollow,
  steerRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
} from './route-chain';
import { makeSeparate } from './separate';

const HEAVY_TIER = CLEARANCE_HEAVY;

// The movement speed stat: logistics' energy modifiers multiply it (ADR
// 0025). With no modifiers stat() returns the base unchanged.
export const MoveSpeed = defineStat('frontline_td:movement.speed');

// Arrival hysteresis thresholds (ADR 0053): moving units enter hold inside
// ARRIVAL_ENTER_DIST and only steer back when pushed beyond HOLD_DEADBAND_DIST.
const ARRIVAL_ENTER_DIST = 0.18;
const HOLD_DEADBAND_DIST = 0.36;
// Smooth arrival slowdown distance next to the slot point.
const SLOWDOWN_DIST = 0.85;
// Within this distance a unit may steer straight at its slot when the cell
// line is walkable (skips flow-field detours next to the goal).
const DIRECT_DIST = 8;

const marginScratch = { x: 0, y: 0 };
const routeScratch = { dx: 0, dy: 0 };

function clampCornerMargin(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  acx: number,
  acy: number,
  ox: number,
  oy: number,
  cxCorner: number,
  cyCorner: number,
  margin: number,
  marginSq: number,
): void {
  const dx = marginScratch.x - cxCorner;
  const dy = marginScratch.y - cyCorner;
  const d2 = dx * dx + dy * dy;
  if (
    d2 < marginSq &&
    d2 > 1e-12 &&
    terrain.stepCost(acx, acy, acx + ox, acy + oy, cls, tier) < 0
  ) {
    const d = Math.sqrt(d2);
    marginScratch.x = cxCorner + (dx / d) * margin;
    marginScratch.y = cyCorner + (dy / d) * margin;
  }
}

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
    [MoveTarget, { goal: 0, x: 0, y: 0, active: 0, stall: 0 }],
    [FormationGuide, { maxSpeed: 0, active: 0 }],
    [RouteFollow, { chain: 0, gate: 0, lane: 0, active: 0 }],
  ];
}

type VelView = WriteView<{ x: 'f64'; y: 'f64' }>;
type TgtView = WriteView<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8'; stall: 'u8' }>;
type GuideView = WriteView<{ maxSpeed: 'f64'; active: 'u8' }>;

// Release the shared goal and hold the slot: the unit steers back to its
// slot point if separation later pushes it off.
function holdUnit(
  pathing: PathingApi,
  routes: RouteChainStore,
  vel: VelView,
  tgt: TgtView,
  guide: GuideView,
  routeOut: RouteFollowView,
  id: number,
): void {
  releaseHeldGoal(pathing, tgt, id);
  clearFormationGuide(guide, id);
  releaseRouteFollow(routes, routeOut, id);
  tgt.active[id] = 2;
  tgt.stall[id] = 0;
  vel.x[id] = 0;
  vel.y[id] = 0;
}

// Release the shared goal and stop the unit for good (unreachable target).
function stopUnit(
  pathing: PathingApi,
  routes: RouteChainStore,
  vel: VelView,
  tgt: TgtView,
  guide: GuideView,
  routeOut: RouteFollowView,
  id: number,
): void {
  releaseHeldGoal(pathing, tgt, id);
  clearFormationGuide(guide, id);
  releaseRouteFollow(routes, routeOut, id);
  tgt.active[id] = 0;
  tgt.stall[id] = 0;
  vel.x[id] = 0;
  vel.y[id] = 0;
}

// Allocation-free wall and convex-corner margin clamping per clearance tier.
// Writes into module-private marginScratch; callers read .x/.y immediately.
function clampFootprintMargin(
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  radius: number,
  x: number,
  y: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  const margin = tier === HEAVY_TIER ? Math.min(radius * 0.85, 0.75) : Math.min(radius * 0.75, 0.3);
  if (margin <= 0) {
    marginScratch.x = nx;
    marginScratch.y = ny;
    return marginScratch;
  }
  const acx = clearanceAnchorCell(nx, tier);
  const acy = clearanceAnchorCell(ny, tier);
  const size = clearanceFootprintSize(tier);
  const nearW = nx < acx + margin;
  const nearE = nx > acx + size - margin;
  const nearN = ny < acy + margin;
  const nearS = ny > acy + size - margin;
  if (!nearW && !nearE && !nearN && !nearS) {
    marginScratch.x = nx;
    marginScratch.y = ny;
    return marginScratch;
  }
  if (!terrain.passable(acx, acy, cls, tier)) {
    marginScratch.x = nx;
    marginScratch.y = ny;
    return marginScratch;
  }
  const wClosed = nearW && terrain.stepCost(acx, acy, acx - 1, acy, cls, tier) < 0;
  if (wClosed) {
    nx = acx + margin;
  }
  const eClosed = nearE && terrain.stepCost(acx, acy, acx + 1, acy, cls, tier) < 0;
  if (eClosed) {
    nx = acx + size - margin;
  }
  const nClosed = nearN && terrain.stepCost(acx, acy, acx, acy - 1, cls, tier) < 0;
  if (nClosed) {
    ny = acy + margin;
  }
  const sClosed = nearS && terrain.stepCost(acx, acy, acx, acy + 1, cls, tier) < 0;
  if (sClosed) {
    ny = acy + size - margin;
  }
  marginScratch.x = nx;
  marginScratch.y = ny;
  const marginSq = margin * margin;
  if (nearW && nearN && !wClosed && !nClosed) {
    clampCornerMargin(terrain, cls, tier, acx, acy, -1, -1, acx, acy, margin, marginSq);
  }
  if (nearE && nearN && !eClosed && !nClosed) {
    clampCornerMargin(terrain, cls, tier, acx, acy, 1, -1, acx + size, acy, margin, marginSq);
  }
  if (nearW && nearS && !wClosed && !sClosed) {
    clampCornerMargin(terrain, cls, tier, acx, acy, -1, 1, acx, acy + size, margin, marginSq);
  }
  if (nearE && nearS && !eClosed && !sClosed) {
    clampCornerMargin(terrain, cls, tier, acx, acy, 1, 1, acx + size, acy + size, margin, marginSq);
  }
  return marginScratch;
}

export function createMovementModule(terrain: TerrainApi, pathing: PathingApi): SimModule {
  let velW: ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  let posW: ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  let tgtW: ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8'; stall: 'u8' }>;
  let guideW: ComponentWriter<{ maxSpeed: 'f64'; active: 'u8' }>;
  let routeW: ComponentWriter<{ chain: 'u32'; gate: 'u16'; lane: 'f64'; active: 'u8' }>;
  const routes = createRouteChainStore();
  terrain.onBlockedChange(() => {
    routes.rejoinMemo.reset();
  });
  const separate = makeSeparate(terrain, () => velW);

  function steer(ctx: SystemContext): void {
    const pos = ctx.read(Position);
    const mover = ctx.read(Mover);
    const target = ctx.read(MoveTarget);
    const guide = ctx.read(FormationGuide);
    const route = ctx.read(RouteFollow);
    const vel = ctx.write(velW);
    const tgt = ctx.write(tgtW);
    const guideOut = ctx.write(guideW);
    const routeOut = ctx.write(routeW) as RouteFollowView;
    const ids = ctx.query([Position, Mover, MoveTarget]);
    const blockedHolder = separate.blockedByHolder();
    const posX = pos.x;
    const posY = pos.y;
    const tgtX = target.x;
    const tgtY = target.y;
    const tgtActive = target.active;
    const tgtGoal = target.goal;
    const guideActive = guide.active;
    const guideMaxSpeed = guide.maxSpeed;
    const routeActive = route.active;
    const moverRadius = mover.radius;
    const moverCls = mover.cls;
    const moverSpeed = mover.speed;
    const velX = vel.x;
    const velY = vel.y;
    const maxScx = terrain.width - 1;
    const maxScy = terrain.height - 1;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const active = tgtActive[id] as number;
      if (active === 0) {
        velX[id] = 0;
        velY[id] = 0;
        continue;
      }
      const px = posX[id] as number;
      const py = posY[id] as number;
      const tx = tgtX[id] as number;
      const ty = tgtY[id] as number;
      const dx = tx - px;
      const dy = ty - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (active === 2) {
        // Holding the slot: deadband prevents separation oscillation; steer smoothly back when pushed out.
        if (dist <= HOLD_DEADBAND_DIST) {
          velX[id] = 0;
          velY[id] = 0;
          continue;
        }
        const scx = Math.min(maxScx, Math.max(0, Math.floor(px)));
        const scy = Math.min(maxScy, Math.max(0, Math.floor(py)));
        const maxSpeed =
          ctx.stat(MoveSpeed, id as EntityId, moverSpeed[id] as number) *
          (terrain.speedBpAt(scx, scy) / 10000);
        const returnScale = Math.min(1, (dist - HOLD_DEADBAND_DIST) / SLOWDOWN_DIST);
        const effSpeed = Math.min(
          maxSpeed * (0.2 + 0.8 * returnScale),
          (dist - ARRIVAL_ENTER_DIST * 0.5) * 0.5,
        );
        if (effSpeed <= 0) {
          velX[id] = 0;
          velY[id] = 0;
        } else {
          velX[id] = (dx / dist) * effSpeed;
          velY[id] = (dy / dist) * effSpeed;
        }
        continue;
      }
      // active === 1 (moving)
      if (dist <= ARRIVAL_ENTER_DIST) {
        holdUnit(pathing, routes, vel, tgt, guideOut, routeOut, id);
        continue;
      }
      const radius = moverRadius[id] as number;
      const cls = moverCls[id] as number;
      const tier = clearanceTierForRadius(radius);
      const gActive = (guideActive[id] as number) === 1;
      let dirX = 0;
      let dirY = 0;
      let approachingSlot = false;
      let steered = false;
      const directLine = dist <= DIRECT_DIST && lineWalkable(terrain, cls, px, py, tx, ty, tier);
      if (dist <= 3.8 && directLine) {
        // Close enough and a legal straight line: release corridor chain and steer straight at slot.
        if ((routeActive[id] as number) === 1) {
          releaseRouteFollow(routes, routeOut, id);
        }
        dirX = dx;
        dirY = dy;
        approachingSlot = true;
        steered = true;
      } else if (
        (routeActive[id] as number) === 1 &&
        steerRouteFollow(routes, terrain, routeOut, id, px, py, cls, tier, routeScratch)
      ) {
        if (directLine && dist > 1e-6) {
          const rLen = Math.sqrt(
            routeScratch.dx * routeScratch.dx + routeScratch.dy * routeScratch.dy,
          );
          const tFade = (DIRECT_DIST - dist) / (DIRECT_DIST - 3.8);
          const rx = rLen > 1e-9 ? routeScratch.dx / rLen : 0;
          const ry = rLen > 1e-9 ? routeScratch.dy / rLen : 0;
          dirX = rx + (dx / dist - rx) * tFade;
          dirY = ry + (dy / dist - ry) * tFade;
          approachingSlot = dist <= 4.6;
        } else {
          dirX = routeScratch.dx;
          dirY = routeScratch.dy;
          approachingSlot = false;
        }
        steered = true;
      } else if (directLine) {
        dirX = dx;
        dirY = dy;
        approachingSlot = true;
        steered = true;
      }
      if (!steered) {
        if (
          dist <= DIRECT_DIST &&
          boundedLocalRejoin(routes, terrain, cls, tier, px, py, tx, ty, routeScratch)
        ) {
          dirX = routeScratch.dx;
          dirY = routeScratch.dy;
          approachingSlot = false;
        } else {
          let flow = pathing.smoothDirectionAt(tgtGoal[id] as number, px, py);
          if (flow === null && tier === 0) {
            const gx = Math.floor(tx);
            const gy = Math.floor(ty);
            const scx = Math.floor(px);
            const scy = Math.floor(py);
            if (
              terrain.inBounds(gx, gy) &&
              terrain.passable(gx, gy, cls, 0) &&
              pathing.reachable(scx, scy, gx, gy, cls, 0)
            ) {
              releaseHeldGoal(pathing, tgt, id);
              const stdGoal = pathing.acquireGoal(gx, gy, cls, 0);
              tgt.goal[id] = stdGoal;
              flow = pathing.smoothDirectionAt(stdGoal, px, py);
            }
          }
          if (flow === null) {
            // Unreachable: give up and stop in place.
            stopUnit(pathing, routes, vel, tgt, guideOut, routeOut, id);
            continue;
          }
          if (flow.dx === 0 && flow.dy === 0) {
            if (
              dist <= 12 &&
              !lineWalkable(terrain, cls, px, py, tx, ty, tier) &&
              boundedLocalRejoin(routes, terrain, cls, tier, px, py, tx, ty, routeScratch)
            ) {
              dirX = routeScratch.dx;
              dirY = routeScratch.dy;
              approachingSlot = false;
            } else {
              // On the goal cell: steer straight at the slot.
              dirX = dx;
              dirY = dy;
              approachingSlot = true;
            }
          } else {
            dirX = flow.dx;
            dirY = flow.dy;
            approachingSlot = false;
          }
        }
      }
      const len = approachingSlot ? dist : Math.sqrt(dirX * dirX + dirY * dirY);
      if (len <= 0) {
        velX[id] = 0;
        velY[id] = 0;
        continue;
      }
      const scx = Math.min(maxScx, Math.max(0, Math.floor(px)));
      const scy = Math.min(maxScy, Math.max(0, Math.floor(py)));
      const statSpeed =
        ctx.stat(MoveSpeed, id as EntityId, moverSpeed[id] as number) *
        (terrain.speedBpAt(scx, scy) / 10000);
      const gCap = gActive ? (guideMaxSpeed[id] as number) : 0;
      const maxSpeed = gCap > 0 && gCap < statSpeed ? gCap : statSpeed;
      const effSpeed =
        approachingSlot && dist < SLOWDOWN_DIST
          ? Math.min(maxSpeed * Math.max(0.25, dist / SLOWDOWN_DIST), dist * 0.65)
          : maxSpeed;
      const pvx = velX[id] ?? 0;
      const pvy = velY[id] ?? 0;
      if (
        dist <= 3.6 &&
        (blockedHolder[id] ?? 0) === 1 &&
        pvx * pvx + pvy * pvy < effSpeed * 0.35 * (effSpeed * 0.35)
      ) {
        const nextStall = (tgt.stall[id] ?? 0) + 1;
        if (nextStall >= 3) {
          tgt.x[id] = px;
          tgt.y[id] = py;
          tgt.stall[id] = 0;
          holdUnit(pathing, routes, vel, tgt, guideOut, routeOut, id);
          continue;
        }
        tgt.stall[id] = nextStall;
      } else {
        tgt.stall[id] = 0;
      }
      const dvx = (dirX / len) * effSpeed;
      const dvy = (dirY / len) * effSpeed;
      if (pvx === 0 && pvy === 0) {
        velX[id] = dvx;
        velY[id] = dvy;
      } else {
        const dot = pvx * dvx + pvy * dvy;
        let txBias = dvx;
        let tyBias = dvy;
        let alpha = 0.48;
        let speedScale = 1;
        if (approachingSlot && dist < 1.2) {
          alpha = 0.72;
        } else if (dot < -0.1 * effSpeed * effSpeed) {
          txBias = dvx - dvy * 0.28;
          tyBias = dvy + dvx * 0.28;
          alpha = 0.45;
          speedScale = 0.75;
        }
        const bx = pvx + (txBias - pvx) * alpha;
        const by = pvy + (tyBias - pvy) * alpha;
        const bLen = Math.sqrt(bx * bx + by * by);
        if (bLen > 1e-12) {
          const outSpeed = effSpeed * speedScale;
          velX[id] = (bx / bLen) * outSpeed;
          velY[id] = (by / bLen) * outSpeed;
        } else {
          velX[id] = dvx;
          velY[id] = dvy;
        }
      }
    }
  }

  function integrate(ctx: SystemContext): void {
    const ids = ctx.query([Position, Velocity, Mover]);
    const pos = ctx.read(Position);
    const vel = ctx.read(Velocity);
    const mover = ctx.read(Mover);
    const out = ctx.write(posW);
    const velOut = ctx.write(velW);
    const posX = pos.x;
    const posY = pos.y;
    const velX = vel.x;
    const velY = vel.y;
    const moverRadius = mover.radius;
    const moverCls = mover.cls;
    const outX = out.x;
    const outY = out.y;
    const velOutX = velOut.x;
    const velOutY = velOut.y;
    const maxX = terrain.width - 1e-9;
    const maxY = terrain.height - 1e-9;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] ?? 0;
      const px = posX[id] ?? 0;
      const py = posY[id] ?? 0;
      const vx = velX[id] ?? 0;
      const vy = velY[id] ?? 0;
      if (vx === 0 && vy === 0) {
        outX[id] = px;
        outY[id] = py;
        velOutX[id] = 0;
        velOutY[id] = 0;
        continue;
      }
      const radius = moverRadius[id] ?? 0;
      const cls = moverCls[id] ?? 0;
      const tier = clearanceTierForRadius(radius);
      const ccx = clearanceAnchorCell(px, tier);
      const ccy = clearanceAnchorCell(py, tier);
      let nx = px + vx;
      let ny = py + vy;
      if (!canStep(terrain, cls, tier, ccx, ccy, nx, ny)) {
        if (canStep(terrain, cls, tier, ccx, ccy, nx, py)) {
          ny = py;
        } else if (canStep(terrain, cls, tier, ccx, ccy, px, ny)) {
          nx = px;
        } else {
          nx = px;
          ny = py;
        }
      }
      const clamped = clampFootprintMargin(terrain, cls, tier, radius, nx, ny);
      const finalX = Math.min(Math.max(clamped.x, 0), maxX);
      const finalY = Math.min(Math.max(clamped.y, 0), maxY);
      outX[id] = finalX;
      outY[id] = finalY;
      velOutX[id] = finalX - px;
      velOutY[id] = finalY - py;
    }
  }

  return {
    id: 'frontline_td:movement',
    install(builder) {
      velW = builder.claimWriter(Velocity);
      posW = builder.claimWriter(Position);
      tgtW = builder.claimWriter(MoveTarget);
      guideW = builder.claimWriter(FormationGuide);
      routeW = builder.claimWriter(RouteFollow);
      // Mover is read-only after spawn (stats come from content).
      builder.ownComponent(Mover);

      builder.state('frontline_td:movement.routes', {
        save: () => ({ routes: routes.save(), blocked: separate.saveBlocked() }),
        load: (data) => {
          const d = data as unknown as { routes?: Serializable; blocked?: number[] };
          routes.load(d.routes ?? data);
          separate.loadBlocked(d.blocked ?? []);
        },
      });

      installMovementIntents(builder, terrain, pathing, routes, tgtW, guideW, routeW);

      builder.system({ id: 'frontline_td:movement.steer', phase: 'movement', run: steer });
      builder.system({
        id: 'frontline_td:movement.separate',
        phase: 'movement',
        run: separate.run,
      });
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
          const guideOut = ctx.write(guideW);
          const routeOut = ctx.write(routeW) as RouteFollowView;
          for (const p of ctx.read(CombatDied)) {
            const id = ctx.resolve(p.handle as EntityHandle);
            if (id === null || !ctx.has(Mover, id)) {
              continue;
            }
            releaseHeldGoal(pathing, target, id);
            clearFormationGuide(guideOut, id);
            releaseRouteFollow(routes, routeOut, id);
            out.goal[id] = 0;
            out.active[id] = 0;
            out.stall[id] = 0;
          }
        },
      });
    },
  };
}
