import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  clearanceAnchorCell,
  spiralOffsets,
  type ClearanceTier,
} from '../../src/features/terrain/rules/index';
import type {
  ChokepointGate,
  RecordedUnit,
  ScenarioMetrics,
  ScenarioRunOutput,
  ScenarioSpec,
} from './types';

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx] ?? 0;
}

function unitGoalFor(
  spec: ScenarioSpec,
  run: ScenarioRunOutput,
  u: RecordedUnit,
): { x: number; y: number } {
  return run.unitGoals.get(u.handle) ?? spec.goal;
}

function isUnitArrivedAt(
  spec: ScenarioSpec,
  run: ScenarioRunOutput,
  u: RecordedUnit,
  t: number,
): boolean {
  if (t < spec.orderStartTick || t < u.firstTick || t > u.lastTick) {
    return false;
  }
  const px = u.xs[t] ?? 0;
  const py = u.ys[t] ?? 0;
  const g = unitGoalFor(spec, run, u);
  const dx = px - (g.x + 0.5);
  const dy = py - (g.y + 0.5);
  const d = Math.hypot(dx, dy);
  const active = u.actives[t] ?? 0;
  const prevX = t > u.firstTick ? (u.xs[t - 1] ?? px) : px;
  const prevY = t > u.firstTick ? (u.ys[t - 1] ?? py) : py;
  const step = Math.hypot(px - prevX, py - prevY);
  if (spec.expectCombat === true) {
    const firedByT = u.shotTicks.some((st) => st <= t);
    return firedByT || (d <= Math.max(4, u.range + 2.2) && (active !== 1 || step < 0.015));
  }
  return (active === 2 && d <= 5.5) || (d <= 4.5 && (active !== 1 || step < 0.015));
}

function computeMstMaxEdge(xs: readonly number[], ys: readonly number[]): number {
  const m = xs.length;
  if (m < 2) {
    return 0;
  }
  const inTree = new Uint8Array(m);
  const minDistSq = new Float64Array(m).fill(Infinity);
  inTree[0] = 1;
  const x0 = xs[0] ?? 0;
  const y0 = ys[0] ?? 0;
  for (let i = 1; i < m; i++) {
    const dx = (xs[i] ?? 0) - x0;
    const dy = (ys[i] ?? 0) - y0;
    minDistSq[i] = dx * dx + dy * dy;
  }
  let maxEdgeSq = 0;
  for (let iter = 1; iter < m; iter++) {
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < m; i++) {
      if (inTree[i] === 0 && (minDistSq[i] ?? Infinity) < bestD2) {
        bestD2 = minDistSq[i] ?? Infinity;
        best = i;
      }
    }
    if (best === -1) {
      break;
    }
    inTree[best] = 1;
    if (bestD2 > maxEdgeSq) {
      maxEdgeSq = bestD2;
    }
    const bx = xs[best] ?? 0;
    const by = ys[best] ?? 0;
    for (let i = 0; i < m; i++) {
      if (inTree[i] !== 0) {
        continue;
      }
      const dx = (xs[i] ?? 0) - bx;
      const dy = (ys[i] ?? 0) - by;
      const d2 = dx * dx + dy * dy;
      if (d2 < (minDistSq[i] ?? Infinity)) {
        minDistSq[i] = d2;
      }
    }
  }
  return Math.sqrt(maxEdgeSq);
}

function nearestPassableGoalCell(
  run: ScenarioRunOutput,
  x: number,
  y: number,
  tier: ClearanceTier,
): { gx: number; gy: number } | null {
  const ax = clearanceAnchorCell(x, tier);
  const ay = clearanceAnchorCell(y, tier);
  if (run.terrain.inBounds(ax, ay) && run.terrain.passable(ax, ay, 0, tier)) {
    return { gx: ax, gy: ay };
  }
  for (const [dx, dy] of spiralOffsets(ax, ay, run.terrain.width, run.terrain.height)) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 4) {
      break;
    }
    if (run.terrain.passable(ax + dx, ay + dy, 0, tier)) {
      return { gx: ax + dx, gy: ay + dy };
    }
  }
  return null;
}

function computeChokepointFlux(
  units: readonly RecordedUnit[],
  gate: ChokepointGate,
  startTick: number,
): number {
  const gx = gate.x1 - gate.x0;
  const gy = gate.y1 - gate.y0;
  const gLenSq = gx * gx + gy * gy;
  if (gLenSq <= 1e-9) {
    return 0;
  }
  const crossTicks: number[] = [];
  for (const u of units) {
    const lo = Math.max(startTick + 1, u.firstTick + 1);
    for (let t = lo; t <= u.lastTick; t++) {
      const px0 = u.xs[t - 1] ?? 0;
      const py0 = u.ys[t - 1] ?? 0;
      const px1 = u.xs[t] ?? 0;
      const py1 = u.ys[t] ?? 0;
      const s0 = (px0 - gate.x0) * gate.nx + (py0 - gate.y0) * gate.ny;
      const s1 = (px1 - gate.x0) * gate.nx + (py1 - gate.y0) * gate.ny;
      const forwardCross = s0 < 0 && s1 >= 0;
      const reverseCross = gate.bidirectional === true && s0 > 0 && s1 <= 0;
      if (!forwardCross && !reverseCross) {
        continue;
      }
      const denom = s0 - s1;
      const frac = Math.abs(denom) > 1e-9 ? s0 / denom : 0.5;
      const ix = px0 + (px1 - px0) * frac;
      const iy = py0 + (py1 - py0) * frac;
      const proj = ((ix - gate.x0) * gx + (iy - gate.y0) * gy) / gLenSq;
      if (proj >= -0.35 && proj <= 1.35) {
        crossTicks.push(t);
        break;
      }
    }
  }
  if (crossTicks.length === 0) {
    return 0;
  }
  if (crossTicks.length === 1) {
    return 100;
  }
  let minT = Infinity;
  let maxT = -Infinity;
  for (const t of crossTicks) {
    if (t < minT) {
      minT = t;
    }
    if (t > maxT) {
      maxT = t;
    }
  }
  return (crossTicks.length * 100) / Math.max(1, maxT - minT);
}

export function computeScenarioMetrics(
  spec: ScenarioSpec,
  run: ScenarioRunOutput,
): ScenarioMetrics {
  const { recording } = run;
  const allUnits = recording.units;
  const group1 = allUnits.filter((u) => u.group === 1);
  const arrivalPopulation = spec.id === 'S4_corridor_head_on' ? allUnits : group1;

  let arrivedCount = 0;
  let firstArrivalTick: number | null = null;
  const arrivedUnits: RecordedUnit[] = [];

  for (const u of arrivalPopulation) {
    let unitArrivedTick: number | null = null;
    for (let t = Math.max(spec.orderStartTick, u.firstTick); t <= u.lastTick; t++) {
      if (isUnitArrivedAt(spec, run, u, t)) {
        unitArrivedTick = t;
        break;
      }
    }
    if (isUnitArrivedAt(spec, run, u, u.lastTick)) {
      arrivedCount += 1;
      arrivedUnits.push(u);
    }
    if (
      u.group === 1 &&
      unitArrivedTick !== null &&
      (firstArrivalTick === null || unitArrivedTick < firstArrivalTick)
    ) {
      firstArrivalTick = unitArrivedTick;
    }
  }

  let settled = false;
  let settlingTicks: number | null = null;
  if (firstArrivalTick !== null && group1.length > 0) {
    const settleNeed = Math.ceil(group1.length * 0.95);
    const window = 10;
    const endLimit = recording.ticks - window;
    for (let t = Math.max(firstArrivalTick, spec.orderStartTick + 1); t <= endLimit; t++) {
      let allCalm = true;
      for (let k = 0; k < window; k++) {
        const tk = t + k;
        let calm = 0;
        for (const u of group1) {
          if (tk <= u.firstTick || tk > u.lastTick) {
            calm += 1;
            continue;
          }
          const step = Math.hypot(
            (u.xs[tk] ?? 0) - (u.xs[tk - 1] ?? 0),
            (u.ys[tk] ?? 0) - (u.ys[tk - 1] ?? 0),
          );
          if (step < 0.008) {
            calm += 1;
          }
        }
        if (calm < settleNeed) {
          allCalm = false;
          break;
        }
      }
      if (allCalm) {
        settled = true;
        settlingTicks = t - firstArrivalTick;
        break;
      }
    }
    if (!settled) {
      settlingTicks = recording.ticks - 1 - firstArrivalTick;
    }
  }

  const stretches: number[] = [];
  const acquiredGoals = new Map<string, number>();
  try {
    for (const u of arrivedUnits) {
      const sTick = Math.max(spec.orderStartTick, u.firstTick);
      const sx = u.xs[sTick] ?? 0;
      const sy = u.ys[sTick] ?? 0;
      const ex = u.xs[u.lastTick] ?? sx;
      const ey = u.ys[u.lastTick] ?? sy;
      let arc = 0;
      for (let t = sTick + 1; t <= u.lastTick; t++) {
        arc += Math.hypot((u.xs[t] ?? 0) - (u.xs[t - 1] ?? 0), (u.ys[t] ?? 0) - (u.ys[t - 1] ?? 0));
      }
      const tier: ClearanceTier = u.radius > 0.45 ? CLEARANCE_HEAVY : CLEARANCE_STANDARD;
      const cell = nearestPassableGoalCell(run, ex, ey, tier);
      let geoDist: number | null = null;
      if (cell !== null) {
        const key = `${tier}:${cell.gx}:${cell.gy}`;
        let goalId = acquiredGoals.get(key);
        if (goalId === undefined) {
          goalId = run.pathing.acquireGoal(cell.gx, cell.gy, 0, tier);
          acquiredGoals.set(key, goalId);
        }
        geoDist = run.pathing.distanceAt(goalId, sx, sy);
      }
      const base = Math.max(geoDist ?? Math.hypot(ex - sx, ey - sy), 1);
      stretches.push(arc / base);
    }
  } finally {
    for (const goalId of acquiredGoals.values()) {
      run.pathing.releaseGoal(goalId);
    }
  }
  stretches.sort((a, b) => a - b);
  const stretchMean =
    stretches.length > 0 ? stretches.reduce((a, b) => a + b, 0) / stretches.length : 0;
  const stretchP95 = percentile(stretches, 0.95);

  const jitters: number[] = [];
  let sharpFlips = 0;
  let movingTicks = 0;
  let stallTicks = 0;
  let wallScrapeCount = 0;

  for (const u of group1) {
    wallScrapeCount += u.wallScrapeTicks;
    const sTick = Math.max(spec.orderStartTick, u.firstTick);
    for (let t = sTick + 1; t <= u.lastTick; t++) {
      const px0 = u.xs[t - 1] ?? 0;
      const py0 = u.ys[t - 1] ?? 0;
      const px1 = u.xs[t] ?? 0;
      const py1 = u.ys[t] ?? 0;
      const vx1 = px1 - px0;
      const vy1 = py1 - py0;
      const len1 = Math.hypot(vx1, vy1);

      if ((u.actives[t] ?? 0) === 1) {
        movingTicks += 1;
        const cx = Math.min(run.terrain.width - 1, Math.max(0, Math.floor(px1)));
        const cy = Math.min(run.terrain.height - 1, Math.max(0, Math.floor(py1)));
        const localMax = u.maxSpeed * (run.terrain.speedBpAt(cx, cy) / 10000);
        if (len1 < 0.2 * localMax) {
          stallTicks += 1;
        }
      }

      if (t >= sTick + 2) {
        const vx0 = px0 - (u.xs[t - 2] ?? px0);
        const vy0 = py0 - (u.ys[t - 2] ?? py0);
        const len0 = Math.hypot(vx0, vy0);
        const minV = 0.15 * u.maxSpeed;
        if (len0 > minV && len1 > minV) {
          const cos = Math.max(-1, Math.min(1, (vx0 * vx1 + vy0 * vy1) / (len0 * len1)));
          const deg = Math.acos(cos) * (180 / Math.PI);
          jitters.push(deg);
          if (deg > 45) {
            sharpFlips += 1;
          }
        }
      }
    }
  }
  jitters.sort((a, b) => a - b);
  const jitterMeanDeg =
    jitters.length > 0 ? jitters.reduce((a, b) => a + b, 0) / jitters.length : 0;
  const jitterP95Deg = percentile(jitters, 0.95);
  const sharpFlipRate = jitters.length > 0 ? sharpFlips / jitters.length : 0;

  let maxBranchGapCells = 0;
  const lateralSpreads: number[] = [];
  for (let t = spec.orderStartTick; t < recording.ticks; t++) {
    const aliveXs: number[] = [];
    const aliveYs: number[] = [];
    let movingCount = 0;
    let sumVx = 0;
    let sumVy = 0;
    for (const u of group1) {
      if (t < u.firstTick || t > u.lastTick) {
        continue;
      }
      const px = u.xs[t] ?? 0;
      const py = u.ys[t] ?? 0;
      aliveXs.push(px);
      aliveYs.push(py);
      if ((u.actives[t] ?? 0) === 1) {
        movingCount += 1;
        if (t > u.firstTick) {
          sumVx += px - (u.xs[t - 1] ?? px);
          sumVy += py - (u.ys[t - 1] ?? py);
        }
      }
    }
    if (movingCount >= 2 && aliveXs.length >= 2) {
      const gap = computeMstMaxEdge(aliveXs, aliveYs);
      if (gap > maxBranchGapCells) {
        maxBranchGapCells = gap;
      }
    }
    if (movingCount >= 4 && aliveXs.length >= 4) {
      const vLen = Math.hypot(sumVx, sumVy);
      if (vLen > 1e-4) {
        const nx = -sumVy / vLen;
        const ny = sumVx / vLen;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < aliveXs.length; i++) {
          cx += aliveXs[i] ?? 0;
          cy += aliveYs[i] ?? 0;
        }
        cx /= aliveXs.length;
        cy /= aliveYs.length;
        let sumLatSq = 0;
        for (let i = 0; i < aliveXs.length; i++) {
          const lat = ((aliveXs[i] ?? 0) - cx) * nx + ((aliveYs[i] ?? 0) - cy) * ny;
          sumLatSq += lat * lat;
        }
        lateralSpreads.push(2 * Math.sqrt(sumLatSq / aliveXs.length));
      }
    }
  }
  lateralSpreads.sort((a, b) => a - b);

  let totalCoreOverlap = 0;
  for (let t = spec.orderStartTick; t < recording.ticks; t++) {
    totalCoreOverlap += recording.perTickCoreOverlap[t] ?? 0;
  }
  const denomUnitTicks = Math.max(1, allUnits.length * (recording.ticks - spec.orderStartTick));

  let firstShotTick: number | null = null;
  let ticksTo80PctFiring: number | null = null;
  let everFiredRatio: number | null = null;
  if (spec.expectCombat === true && group1.length > 0) {
    const firstShots: number[] = [];
    for (const u of group1) {
      const s0 = u.shotTicks[0];
      if (s0 !== undefined) {
        firstShots.push(s0);
        if (firstShotTick === null || s0 < firstShotTick) {
          firstShotTick = s0;
        }
      }
    }
    firstShots.sort((a, b) => a - b);
    everFiredRatio = firstShots.length / group1.length;
    const k80 = Math.ceil(group1.length * 0.8) - 1;
    const t80 = firstShots[k80];
    if (firstShotTick !== null && t80 !== undefined) {
      ticksTo80PctFiring = t80 - firstShotTick;
    }
  }

  return {
    unitCount: arrivalPopulation.length,
    arrivedRatio: arrivalPopulation.length > 0 ? arrivedCount / arrivalPopulation.length : 0,
    firstArrivalTick,
    settlingTicks,
    settled,
    stretchMean,
    stretchP95,
    jitterMeanDeg,
    jitterP95Deg,
    sharpFlipRate,
    splitDetected: maxBranchGapCells > 4.5,
    maxBranchGapCells,
    p95LateralSpreadCells: percentile(lateralSpreads, 0.95),
    stallRatio: movingTicks > 0 ? stallTicks / movingTicks : 0,
    chokepointFluxPer100Ticks:
      spec.chokepointGate !== undefined
        ? computeChokepointFlux(allUnits, spec.chokepointGate, spec.orderStartTick)
        : null,
    coreOverlapPerUnitTick: totalCoreOverlap / denomUnitTicks,
    wallScrapeCount,
    firstShotTick,
    ticksTo80PctFiring,
    everFiredRatio,
  };
}
