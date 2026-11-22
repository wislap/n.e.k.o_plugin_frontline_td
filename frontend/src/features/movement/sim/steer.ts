// Steer system: pick a desired direction per moving unit (direct slot,
// route chain, bounded rejoin, flow field with tier-0 fallback), apply
// effective speed (stat × terrain × guide cap × slowdown), stall
// contagion, then blend the previous velocity toward it (inertia).
import type { EntityId } from '../../../core/index';
import type { ComponentWriter, SystemContext, WriteView } from '../../../kernel/index';
import { defineStat } from '../../../kernel/index';
import type { PathingApi } from '../../pathing/sim/index';
import { clearanceTierForRadius, type ClearanceTier } from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { FormationGuide, MoveTarget, Mover, Position, RouteFollow } from './components';
import { clearFormationGuide, releaseHeldGoal } from './intents';
import { lineWalkable } from './line';
import {
  boundedLocalRejoin,
  releaseRouteFollow,
  steerRouteFollow,
  type RouteChainStore,
  type RouteFollowView,
} from './route-chain';
import type { makeSeparate } from './separate';

type SeparateApi = ReturnType<typeof makeSeparate>;

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
// Inside this distance a legal straight line releases the corridor chain
// and steers straight at the slot.
const DIRECT_SLOT_DIST = 3.8;
// Route-followed units count as approaching their slot inside this range.
const ROUTE_APPROACH_DIST = 4.6;
// Hold-return speed floor/range: effSpeed = maxSpeed * (MIN + RANGE * scale).
const HOLD_RETURN_MIN = 0.2;
const HOLD_RETURN_RANGE = 0.8;
// Blocked units inside STALL_DIST moving slower than STALL_SPEED_FRACTION of
// their effective speed accumulate stall ticks; STALL_TICKS in a row converts
// them to holding in place (stops stall contagion through a packed group).
const STALL_DIST = 3.6;
const STALL_SPEED_FRACTION = 0.35;
const STALL_TICKS = 3;
// Arrival slowdown: speed is at least SLOWDOWN_MIN_SCALE of max and never
// exceeds SLOWDOWN_DIST_FACTOR × remaining distance.
const SLOWDOWN_MIN_SCALE = 0.25;
const SLOWDOWN_DIST_FACTOR = 0.65;
// Inertia blend: fraction of the desired velocity mixed in per tick; slot
// approach blends faster once inside SLOT_BLEND_DIST.
const INERTIA_ALPHA = 0.48;
const INERTIA_ALPHA_SLOT = 0.72;
const SLOT_BLEND_DIST = 1.2;
// Hard reverse: when the desired direction opposes current velocity
// (dot < REVERSE_DOT × effSpeed²), bias sideways by REVERSE_BIAS, blend at
// REVERSE_ALPHA and cap speed at REVERSE_SPEED of the target.
const REVERSE_DOT = -0.1;
const REVERSE_BIAS = 0.28;
const REVERSE_ALPHA = 0.45;
const REVERSE_SPEED = 0.75;
// When already on the goal cell but the slot line is blocked, attempt a
// bounded local rejoin inside this distance.
const REJOIN_STALE_DIST = 12;

type VelView = WriteView<{ x: 'f64'; y: 'f64' }>;
type TgtView = WriteView<{
  goal: 'u32';
  x: 'f64';
  y: 'f64';
  active: 'u8';
  stall: 'u8';
}>;
type GuideView = WriteView<{ maxSpeed: 'f64'; active: 'u8' }>;

export interface SteerWriters {
  vel(): ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  tgt(): ComponentWriter<{ goal: 'u32'; x: 'f64'; y: 'f64'; active: 'u8'; stall: 'u8' }>;
  guide(): ComponentWriter<{ maxSpeed: 'f64'; active: 'u8' }>;
  route(): ComponentWriter<{ chain: 'u32'; gate: 'u16'; lane: 'f64'; active: 'u8' }>;
}

// Per-call context, repopulated at the start of each steer() invocation;
// allocated once inside makeSteer.
interface SteerFrame {
  ctx: SystemContext;
  pathing: PathingApi;
  terrain: TerrainApi;
  routes: RouteChainStore;
  vel: VelView;
  tgt: TgtView;
  guideOut: GuideView;
  routeOut: RouteFollowView;
  tgtGoal: ArrayLike<number>;
  routeActive: ArrayLike<number>;
  blockedHolder: ArrayLike<number>;
  maxScx: number;
  maxScy: number;
  // Out-param for steerRouteFollow / boundedLocalRejoin.
  rs: { dx: number; dy: number };
}

// Per-unit scratch, refilled for each entity in the steer loop; allocated
// once inside makeSteer.
interface SteerUnit {
  id: number;
  px: number;
  py: number;
  tx: number;
  ty: number;
  dx: number;
  dy: number;
  dist: number;
  cls: number;
  tier: ClearanceTier;
  speed: number;
  gCap: number;
  directLine: boolean;
  // Direction-selection out fields (picked each iteration, read immediately).
  dirX: number;
  dirY: number;
  approaching: boolean;
  picked: boolean;
  // Velocity-stage fields.
  pvx: number;
  pvy: number;
  dvx: number;
  dvy: number;
  effSpeed: number;
}

// Release the shared goal and hold the slot: the unit steers back to its
// slot point if separation later pushes it off.
function holdUnit(frame: SteerFrame, unit: SteerUnit): void {
  releaseHeldGoal(frame.pathing, frame.tgt, unit.id);
  clearFormationGuide(frame.guideOut, unit.id);
  releaseRouteFollow(frame.routes, frame.routeOut, unit.id);
  frame.tgt.active[unit.id] = 2;
  frame.tgt.stall[unit.id] = 0;
  frame.vel.x[unit.id] = 0;
  frame.vel.y[unit.id] = 0;
}

// Release the shared goal and stop the unit for good (unreachable target).
function stopUnit(frame: SteerFrame, unit: SteerUnit): void {
  releaseHeldGoal(frame.pathing, frame.tgt, unit.id);
  clearFormationGuide(frame.guideOut, unit.id);
  releaseRouteFollow(frame.routes, frame.routeOut, unit.id);
  frame.tgt.active[unit.id] = 0;
  frame.tgt.stall[unit.id] = 0;
  frame.vel.x[unit.id] = 0;
  frame.vel.y[unit.id] = 0;
}

// Held unit (active === 2): deadband prevents separation oscillation;
// steer smoothly back toward the slot when pushed outside it. Writes the
// velocity directly.
function steerHolding(frame: SteerFrame, unit: SteerUnit): void {
  const { ctx, terrain, vel, maxScx, maxScy } = frame;
  const { id, px, py, dx, dy, dist } = unit;
  if (dist <= HOLD_DEADBAND_DIST) {
    vel.x[id] = 0;
    vel.y[id] = 0;
    return;
  }
  const scx = Math.min(maxScx, Math.max(0, Math.floor(px)));
  const scy = Math.min(maxScy, Math.max(0, Math.floor(py)));
  const maxSpeed =
    ctx.stat(MoveSpeed, id as EntityId, unit.speed) * (terrain.speedBpAt(scx, scy) / 10000);
  const returnScale = Math.min(1, (dist - HOLD_DEADBAND_DIST) / SLOWDOWN_DIST);
  const effSpeed = Math.min(
    maxSpeed * (HOLD_RETURN_MIN + HOLD_RETURN_RANGE * returnScale),
    (dist - ARRIVAL_ENTER_DIST * 0.5) * 0.5,
  );
  if (effSpeed <= 0) {
    vel.x[id] = 0;
    vel.y[id] = 0;
  } else {
    vel.x[id] = (dx / dist) * effSpeed;
    vel.y[id] = (dy / dist) * effSpeed;
  }
}

// Direction selection stage: writes unit.dirX/dirY/approaching/picked.
// Returns false when the unit was stopped (unreachable target) and the
// caller must `continue`.
function pickDirection(frame: SteerFrame, unit: SteerUnit): boolean {
  const { terrain, pathing, routes, tgtGoal, tgt, routeActive, rs } = frame;
  const { id, px, py, tx, ty, dx, dy, dist, cls, tier, directLine } = unit;
  if (dist <= DIRECT_SLOT_DIST && directLine) {
    // Close enough and a legal straight line: release corridor chain and steer straight at slot.
    if ((routeActive[id] as number) === 1) {
      releaseRouteFollow(routes, frame.routeOut, id);
    }
    unit.dirX = dx;
    unit.dirY = dy;
    unit.approaching = true;
    unit.picked = true;
    return true;
  }
  if (
    (routeActive[id] as number) === 1 &&
    steerRouteFollow(routes, terrain, frame.routeOut, id, px, py, cls, tier, rs)
  ) {
    if (directLine && dist > 1e-6) {
      const rLen = Math.sqrt(rs.dx * rs.dx + rs.dy * rs.dy);
      const tFade = (DIRECT_DIST - dist) / (DIRECT_DIST - DIRECT_SLOT_DIST);
      const rx = rLen > 1e-9 ? rs.dx / rLen : 0;
      const ry = rLen > 1e-9 ? rs.dy / rLen : 0;
      unit.dirX = rx + (dx / dist - rx) * tFade;
      unit.dirY = ry + (dy / dist - ry) * tFade;
      unit.approaching = dist <= ROUTE_APPROACH_DIST;
    } else {
      unit.dirX = rs.dx;
      unit.dirY = rs.dy;
      unit.approaching = false;
    }
    unit.picked = true;
    return true;
  }
  if (directLine) {
    unit.dirX = dx;
    unit.dirY = dy;
    unit.approaching = true;
    unit.picked = true;
    return true;
  }
  if (dist <= DIRECT_DIST && boundedLocalRejoin(routes, terrain, cls, tier, px, py, tx, ty, rs)) {
    unit.dirX = rs.dx;
    unit.dirY = rs.dy;
    unit.approaching = false;
    unit.picked = true;
    return true;
  }
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
    stopUnit(frame, unit);
    return false;
  }
  if (flow.dx === 0 && flow.dy === 0) {
    if (
      dist <= REJOIN_STALE_DIST &&
      !lineWalkable(terrain, cls, px, py, tx, ty, tier) &&
      boundedLocalRejoin(routes, terrain, cls, tier, px, py, tx, ty, rs)
    ) {
      unit.dirX = rs.dx;
      unit.dirY = rs.dy;
      unit.approaching = false;
    } else {
      // On the goal cell: steer straight at the slot.
      unit.dirX = dx;
      unit.dirY = dy;
      unit.approaching = true;
    }
  } else {
    unit.dirX = flow.dx;
    unit.dirY = flow.dy;
    unit.approaching = false;
  }
  unit.picked = true;
  return true;
}

// Effective speed stage: stat × terrain surface, guide cap, arrival
// slowdown band when approaching the slot.
function effectiveSpeed(frame: SteerFrame, unit: SteerUnit): number {
  const { ctx, terrain, maxScx, maxScy } = frame;
  const { id, px, py, dist, approaching } = unit;
  const scx = Math.min(maxScx, Math.max(0, Math.floor(px)));
  const scy = Math.min(maxScy, Math.max(0, Math.floor(py)));
  const statSpeed =
    ctx.stat(MoveSpeed, id as EntityId, unit.speed) * (terrain.speedBpAt(scx, scy) / 10000);
  const maxSpeed = unit.gCap > 0 && unit.gCap < statSpeed ? unit.gCap : statSpeed;
  return approaching && dist < SLOWDOWN_DIST
    ? Math.min(
        maxSpeed * Math.max(SLOWDOWN_MIN_SCALE, dist / SLOWDOWN_DIST),
        dist * SLOWDOWN_DIST_FACTOR,
      )
    : maxSpeed;
}

// Stall contagion stage: a unit blocked by an already-holding friendly
// inside STALL_DIST while nearly stopped accumulates stall ticks; after
// STALL_TICKS it converts to holding in place. Returns true when the unit
// was put on hold and the caller must `continue`.
function stallContagion(frame: SteerFrame, unit: SteerUnit): boolean {
  const { tgt, blockedHolder } = frame;
  const { id, px, py, dist, pvx, pvy, effSpeed } = unit;
  if (
    dist <= STALL_DIST &&
    (blockedHolder[id] ?? 0) === 1 &&
    pvx * pvx + pvy * pvy < effSpeed * STALL_SPEED_FRACTION * (effSpeed * STALL_SPEED_FRACTION)
  ) {
    const nextStall = (tgt.stall[id] ?? 0) + 1;
    if (nextStall >= STALL_TICKS) {
      tgt.x[id] = px;
      tgt.y[id] = py;
      tgt.stall[id] = 0;
      holdUnit(frame, unit);
      return true;
    }
    tgt.stall[id] = nextStall;
  } else {
    tgt.stall[id] = 0;
  }
  return false;
}

// Inertia blend stage: mix previous velocity toward the desired velocity;
// faster blend near the slot, sideways bias + speed cap on hard reversals.
function blendVelocity(frame: SteerFrame, unit: SteerUnit): void {
  const { vel } = frame;
  const { id, pvx, pvy, dvx, dvy, effSpeed, approaching, dist } = unit;
  const dot = pvx * dvx + pvy * dvy;
  let txBias = dvx;
  let tyBias = dvy;
  let alpha = INERTIA_ALPHA;
  let speedScale = 1;
  if (approaching && dist < SLOT_BLEND_DIST) {
    alpha = INERTIA_ALPHA_SLOT;
  } else if (dot < REVERSE_DOT * effSpeed * effSpeed) {
    txBias = dvx - dvy * REVERSE_BIAS;
    tyBias = dvy + dvx * REVERSE_BIAS;
    alpha = REVERSE_ALPHA;
    speedScale = REVERSE_SPEED;
  }
  const bx = pvx + (txBias - pvx) * alpha;
  const by = pvy + (tyBias - pvy) * alpha;
  const bLen = Math.sqrt(bx * bx + by * by);
  if (bLen > 1e-12) {
    const outSpeed = effSpeed * speedScale;
    vel.x[id] = (bx / bLen) * outSpeed;
    vel.y[id] = (by / bLen) * outSpeed;
  } else {
    vel.x[id] = dvx;
    vel.y[id] = dvy;
  }
}

export function makeSteer(
  terrain: TerrainApi,
  pathing: PathingApi,
  routes: RouteChainStore,
  separate: SeparateApi,
  writers: SteerWriters,
): (ctx: SystemContext) => void {
  const frame: SteerFrame = {
    ctx: null as unknown as SystemContext,
    pathing,
    terrain,
    routes,
    vel: null as unknown as VelView,
    tgt: null as unknown as TgtView,
    guideOut: null as unknown as GuideView,
    routeOut: null as unknown as RouteFollowView,
    tgtGoal: [],
    routeActive: [],
    blockedHolder: [],
    maxScx: 0,
    maxScy: 0,
    rs: { dx: 0, dy: 0 },
  };
  const unit: SteerUnit = {
    id: 0,
    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
    dx: 0,
    dy: 0,
    dist: 0,
    cls: 0,
    tier: 0,
    speed: 0,
    gCap: 0,
    directLine: false,
    dirX: 0,
    dirY: 0,
    approaching: false,
    picked: false,
    pvx: 0,
    pvy: 0,
    dvx: 0,
    dvy: 0,
    effSpeed: 0,
  };
  return function steer(ctx: SystemContext): void {
    const pos = ctx.read(Position);
    const mover = ctx.read(Mover);
    const target = ctx.read(MoveTarget);
    const guide = ctx.read(FormationGuide);
    const route = ctx.read(RouteFollow);
    const ids = ctx.query([Position, Mover, MoveTarget]);
    frame.ctx = ctx;
    frame.vel = ctx.write(writers.vel());
    frame.tgt = ctx.write(writers.tgt());
    frame.guideOut = ctx.write(writers.guide());
    frame.routeOut = ctx.write(writers.route());
    frame.blockedHolder = separate.blockedByHolder();
    frame.tgtGoal = target.goal;
    frame.routeActive = route.active;
    frame.maxScx = terrain.width - 1;
    frame.maxScy = terrain.height - 1;
    const tgtX = target.x;
    const tgtY = target.y;
    const tgtActive = target.active;
    const guideActive = guide.active;
    const guideMaxSpeed = guide.maxSpeed;
    const moverRadius = mover.radius;
    const moverCls = mover.cls;
    const moverSpeed = mover.speed;
    const posX = pos.x;
    const posY = pos.y;
    const vel = frame.vel;
    const velX = vel.x;
    const velY = vel.y;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const active = tgtActive[id] as number;
      if (active === 0) {
        velX[id] = 0;
        velY[id] = 0;
        continue;
      }
      unit.id = id;
      unit.px = posX[id] as number;
      unit.py = posY[id] as number;
      unit.tx = tgtX[id] as number;
      unit.ty = tgtY[id] as number;
      const dx = unit.tx - unit.px;
      const dy = unit.ty - unit.py;
      unit.dx = dx;
      unit.dy = dy;
      unit.dist = Math.sqrt(dx * dx + dy * dy);
      if (active === 2) {
        unit.speed = moverSpeed[id] as number;
        steerHolding(frame, unit);
        continue;
      }
      // active === 1 (moving)
      if (unit.dist <= ARRIVAL_ENTER_DIST) {
        holdUnit(frame, unit);
        continue;
      }
      const radius = moverRadius[id] as number;
      unit.cls = moverCls[id] as number;
      unit.tier = clearanceTierForRadius(radius);
      unit.speed = moverSpeed[id] as number;
      const gActive = (guideActive[id] as number) === 1;
      unit.directLine =
        unit.dist <= DIRECT_DIST &&
        lineWalkable(terrain, unit.cls, unit.px, unit.py, unit.tx, unit.ty, unit.tier);
      unit.picked = false;
      if (!pickDirection(frame, unit)) {
        continue;
      }
      const dirX = unit.dirX;
      const dirY = unit.dirY;
      const approachingSlot = unit.approaching;
      const len = approachingSlot ? unit.dist : Math.sqrt(dirX * dirX + dirY * dirY);
      if (len <= 0) {
        velX[id] = 0;
        velY[id] = 0;
        continue;
      }
      unit.gCap = gActive ? (guideMaxSpeed[id] as number) : 0;
      unit.effSpeed = effectiveSpeed(frame, unit);
      unit.pvx = velX[id] ?? 0;
      unit.pvy = velY[id] ?? 0;
      if (stallContagion(frame, unit)) {
        continue;
      }
      unit.dvx = (dirX / len) * unit.effSpeed;
      unit.dvy = (dirY / len) * unit.effSpeed;
      if (unit.pvx === 0 && unit.pvy === 0) {
        velX[id] = unit.dvx;
        velY[id] = unit.dvy;
      } else {
        blendVelocity(frame, unit);
      }
    }
  };
}
