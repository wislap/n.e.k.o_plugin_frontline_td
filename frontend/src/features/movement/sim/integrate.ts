// Integrate system: apply velocity with passability checks (axis slide,
// per-tier footprint margin clamping) and write the effective velocity.
import type { ComponentWriter, SystemContext } from '../../../kernel/index';
import {
  CLEARANCE_HEAVY,
  clearanceAnchorCell,
  clearanceFootprintSize,
  clearanceTierForRadius,
  type ClearanceTier,
} from '../../terrain/rules/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { Mover, Position, Velocity } from './components';
import { canStep } from './line';

const HEAVY_TIER = CLEARANCE_HEAVY;

// Footprint margin per tier: fraction of the mover radius, capped.
const MARGIN_RADIUS_HEAVY = 0.85;
const MARGIN_MAX_HEAVY = 0.75;
const MARGIN_RADIUS_LIGHT = 0.75;
const MARGIN_MAX_LIGHT = 0.3;

function clampCornerMargin(
  marginScratch: { x: number; y: number },
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

// Allocation-free wall and convex-corner margin clamping per clearance tier.
// Writes into the caller-provided marginScratch; read .x/.y immediately.
function clampFootprintMargin(
  marginScratch: { x: number; y: number },
  terrain: TerrainApi,
  cls: number,
  tier: ClearanceTier,
  radius: number,
  x: number,
  y: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  const margin =
    tier === HEAVY_TIER
      ? Math.min(radius * MARGIN_RADIUS_HEAVY, MARGIN_MAX_HEAVY)
      : Math.min(radius * MARGIN_RADIUS_LIGHT, MARGIN_MAX_LIGHT);
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
    clampCornerMargin(
      marginScratch,
      terrain,
      cls,
      tier,
      acx,
      acy,
      -1,
      -1,
      acx,
      acy,
      margin,
      marginSq,
    );
  }
  if (nearE && nearN && !eClosed && !nClosed) {
    clampCornerMargin(
      marginScratch,
      terrain,
      cls,
      tier,
      acx,
      acy,
      1,
      -1,
      acx + size,
      acy,
      margin,
      marginSq,
    );
  }
  if (nearW && nearS && !wClosed && !sClosed) {
    clampCornerMargin(
      marginScratch,
      terrain,
      cls,
      tier,
      acx,
      acy,
      -1,
      1,
      acx,
      acy + size,
      margin,
      marginSq,
    );
  }
  if (nearE && nearS && !eClosed && !sClosed) {
    clampCornerMargin(
      marginScratch,
      terrain,
      cls,
      tier,
      acx,
      acy,
      1,
      1,
      acx + size,
      acy + size,
      margin,
      marginSq,
    );
  }
  return marginScratch;
}

export function makeIntegrate(
  terrain: TerrainApi,
  writers: {
    pos(): ComponentWriter<{ x: 'f64'; y: 'f64' }>;
    vel(): ComponentWriter<{ x: 'f64'; y: 'f64' }>;
  },
): (ctx: SystemContext) => void {
  const marginScratch = { x: 0, y: 0 };
  return function integrate(ctx: SystemContext): void {
    const ids = ctx.query([Position, Velocity, Mover]);
    const pos = ctx.read(Position);
    const vel = ctx.read(Velocity);
    const mover = ctx.read(Mover);
    const out = ctx.write(writers.pos());
    const velOut = ctx.write(writers.vel());
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
      const clamped = clampFootprintMargin(marginScratch, terrain, cls, tier, radius, nx, ny);
      const finalX = Math.min(Math.max(clamped.x, 0), maxX);
      const finalY = Math.min(Math.max(clamped.y, 0), maxY);
      outX[id] = finalX;
      outY[id] = finalY;
      velOutX[id] = finalX - px;
      velOutY[id] = finalY - py;
    }
  };
}
