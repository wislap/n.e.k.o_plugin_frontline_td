// Uniform-grid separation: pairwise overlap resolution on a fixed 2-cell
// bucket grid (ADR 0053). Uses two-slope overdamped repulsion, mass × state
// asymmetric yielding, tangential wrapping, and per-tick push clamping.
// Buffers are reused every tick and never reallocated (ADR 0020).
import type { ComponentWriter, SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { MoveTarget, Mover, Position, Velocity } from './components';

// Separation bucket size in cells.
const BUCKET = 2;
// Breathing buffer outside summed radii; soft repulsion resolves light
// grazing before core penetration engages.
const SEPARATION_GAP = 0.08;
// Two-slope overdamped stiffnesses (buffer vs core penetration).
const SOFT_STIFFNESS = 0.25;
const CORE_STIFFNESS = 0.65;
// Same-faction state weights for asymmetric yielding (w = r^2 * stateWeight).
const STATE_MOVING_WEIGHT = 2.5;
const STATE_STOPPED_WEIGHT = 1.8;
const STATE_HOLDING_WEIGHT = 0.6;
// Tangential wrap coefficient for oncoming / overtaking pairs.
const WRAP_FACTOR = 0.6;
// Per-tick push clamp relative to unit base speed.
const MAX_PUSH_SPEED_FACTOR = 1.15;
const MIN_MAX_PUSH = 0.06;

// Fixed neighbour-bucket order for pair iteration (deterministic).
const NB_DX = new Int8Array([-1, 0, 1, -1, 0, 1, -1, 0, 1]);
const NB_DY = new Int8Array([-1, -1, -1, 0, 0, 0, 1, 1, 1]);

type VelWriter = ComponentWriter<{ x: 'f64'; y: 'f64' }>;

function stateWeight(active: number): number {
  return active === 1
    ? STATE_MOVING_WEIGHT
    : active === 2
      ? STATE_HOLDING_WEIGHT
      : STATE_STOPPED_WEIGHT;
}

export function makeSeparate(terrain: TerrainApi, velW: () => VelWriter) {
  // Flat bucket linked list (head[key] -> first slot, next[slot] -> next slot
  // in ascending id order). Fallback map handles out-of-bounds coordinates in tests.
  const bucketCols = Math.ceil(terrain.width / BUCKET);
  const bucketRows = Math.ceil(terrain.height / BUCKET);
  const totalBuckets = bucketCols * bucketRows;
  const head = new Int32Array(totalBuckets);
  let next = new Int32Array(64);
  let oobBuckets: Map<number, number[]> | null = null;
  let pushX = new Float64Array(64);
  let pushY = new Float64Array(64);

  return function separate(ctx: SystemContext): void {
    const ids = ctx.query([Position, Mover]);
    const count = ids.length;
    const pos = ctx.read(Position);
    const mover = ctx.read(Mover);
    const velR = ctx.read(Velocity);
    const fac = ctx.read(Faction);
    const target = ctx.read(MoveTarget);
    const posX = pos.x;
    const posY = pos.y;
    const moverR = mover.radius;
    const moverSpeed = mover.speed;
    const velRX = velR.x;
    const velRY = velR.y;
    const facId = fac.id;
    const tgtActive = target.active;

    if (pushX.length < count) {
      pushX = new Float64Array(count * 2);
      pushY = new Float64Array(count * 2);
      next = new Int32Array(count * 2);
    }
    pushX.fill(0, 0, count);
    pushY.fill(0, 0, count);
    head.fill(-1);
    if (oobBuckets !== null) {
      for (const list of oobBuckets.values()) {
        list.length = 0;
      }
    }
    // Insert in reverse slot order so singly-linked bucket traversal yields ascending slot order.
    for (let slot = count - 1; slot >= 0; slot--) {
      const id = ids[slot] ?? 0;
      const bx = Math.min(Math.floor((posX[id] ?? 0) / BUCKET), bucketCols - 1);
      const by = Math.floor((posY[id] ?? 0) / BUCKET);
      const key = by * bucketCols + bx;
      if (bx >= 0 && key >= 0 && key < totalBuckets) {
        next[slot] = head[key] ?? -1;
        head[key] = slot;
      } else {
        if (oobBuckets === null) {
          oobBuckets = new Map();
        }
        let list = oobBuckets.get(key);
        if (list === undefined) {
          list = [];
          oobBuckets.set(key, list);
        }
        list.unshift(slot);
      }
    }

    const resolvePair = (
      slot: number,
      other: number,
      a: number,
      ax: number,
      ay: number,
      ar: number,
      ma: number,
      fa: number,
      actA: number,
      vax: number,
      vay: number,
    ): void => {
      if (other <= slot) {
        return;
      }
      const b = ids[other] ?? 0;
      const br = moverR[b] ?? 0;
      const ddx = (posX[b] ?? 0) - ax;
      const ddy = (posY[b] ?? 0) - ay;
      const maxDist = ar + br + SEPARATION_GAP;
      if (Math.abs(ddx) >= maxDist || Math.abs(ddy) >= maxDist) {
        return;
      }
      const distSq = ddx * ddx + ddy * ddy;
      const distLimit = maxDist + 1e-12;
      if (distSq >= distLimit * distLimit) {
        return;
      }
      const dist = Math.sqrt(distSq);
      const overlap = maxDist - dist;
      if (overlap <= 0) {
        return;
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
      const soft = Math.min(overlap, SEPARATION_GAP);
      const core = overlap - soft;
      const impulse = soft * SOFT_STIFFNESS + core * CORE_STIFFNESS;

      const mb = Math.max(br * br, 0.01);
      const fb = facId[b] ?? 0;
      const sameFaction = fa !== 0 && fa === fb;
      const actB = tgtActive[b] ?? 0;
      const wMassA = sameFaction ? ma * stateWeight(actA) : ma;
      const wMassB = sameFaction ? mb * stateWeight(actB) : mb;
      const invTotal = 1 / (wMassA + wMassB);
      // Lighter / yielding unit absorbs larger share.
      const shareA = wMassB * invTotal;
      const shareB = wMassA * invTotal;

      let pax = (pushX[slot] ?? 0) - ux * impulse * shareA;
      let pay = (pushY[slot] ?? 0) - uy * impulse * shareA;
      let pbx = (pushX[other] ?? 0) + ux * impulse * shareB;
      let pby = (pushY[other] ?? 0) + uy * impulse * shareB;

      if (actA === 1 || actB === 1) {
        const tx = -uy;
        const ty = ux;
        const vbx = velRX[b] ?? 0;
        const vby = velRY[b] ?? 0;
        const dotA = vax * ux + vay * uy;
        const dotB = vbx * ux + vby * uy;
        if (actA === 1 && actB === 1 && dotA > 0 && dotB < 0) {
          // Opposing movers colliding: steer both tangentially around each other.
          const relSide = (vax - vbx) * tx + (vay - vby) * ty;
          const s = Math.abs(relSide) > 1e-6 ? (relSide > 0 ? 1 : -1) : 1;
          const wrapMag = impulse * WRAP_FACTOR;
          pax += s * shareA * wrapMag * tx;
          pay += s * shareA * wrapMag * ty;
          pbx -= s * shareB * wrapMag * tx;
          pby -= s * shareB * wrapMag * ty;
        } else if (sameFaction) {
          if (actA === 1 && actB !== 1 && dotA > 0) {
            const sideA = vax * tx + vay * ty;
            const sA = Math.abs(sideA) > 1e-6 ? (sideA > 0 ? 1 : -1) : (a + b) % 2 === 0 ? 1 : -1;
            const wrapA = sA * shareA * impulse * WRAP_FACTOR;
            pax += wrapA * tx;
            pay += wrapA * ty;
          } else if (actB === 1 && actA !== 1 && dotB < 0) {
            const sideB = vbx * -tx + vby * -ty;
            const sB = Math.abs(sideB) > 1e-6 ? (sideB > 0 ? 1 : -1) : (a + b) % 2 === 0 ? 1 : -1;
            const wrapB = sB * shareB * impulse * WRAP_FACTOR;
            pbx += wrapB * -tx;
            pby += wrapB * -ty;
          }
        }
      }

      pushX[slot] = pax;
      pushY[slot] = pay;
      pushX[other] = pbx;
      pushY[other] = pby;
    };

    for (let slot = 0; slot < count; slot++) {
      const a = ids[slot] ?? 0;
      const ax = posX[a] ?? 0;
      const ay = posY[a] ?? 0;
      const ar = moverR[a] ?? 0;
      const ma = Math.max(ar * ar, 0.01);
      const fa = facId[a] ?? 0;
      const actA = tgtActive[a] ?? 0;
      const vax = velRX[a] ?? 0;
      const vay = velRY[a] ?? 0;
      const bx = Math.floor(ax / BUCKET);
      const by = Math.floor(ay / BUCKET);
      for (let n = 0; n < 9; n++) {
        const nbKey = (by + (NB_DY[n] ?? 0)) * bucketCols + bx + (NB_DX[n] ?? 0);
        if (nbKey >= 0 && nbKey < totalBuckets) {
          let other = head[nbKey] ?? -1;
          while (other !== -1) {
            resolvePair(slot, other, a, ax, ay, ar, ma, fa, actA, vax, vay);
            other = next[other] ?? -1;
          }
        } else if (oobBuckets !== null) {
          const list = oobBuckets.get(nbKey);
          if (list !== undefined) {
            for (let j = 0; j < list.length; j++) {
              resolvePair(slot, list[j] ?? 0, a, ax, ay, ar, ma, fa, actA, vax, vay);
            }
          }
        }
      }
    }
    // Pushes ride on Velocity so integrate applies the passability fallback;
    // steer zeroes velocity for idle units each tick, so it never accumulates.
    const vel = ctx.write(velW());
    const velWX = vel.x;
    const velWY = vel.y;
    for (let slot = 0; slot < count; slot++) {
      let pxPush = pushX[slot] ?? 0;
      let pyPush = pushY[slot] ?? 0;
      if (pxPush === 0 && pyPush === 0) {
        continue;
      }
      const id = ids[slot] ?? 0;
      const maxPush = Math.max(MIN_MAX_PUSH, (moverSpeed[id] ?? 0) * MAX_PUSH_SPEED_FACTOR);
      const magSq = pxPush * pxPush + pyPush * pyPush;
      if (magSq > maxPush * maxPush) {
        const scale = maxPush / Math.sqrt(magSq);
        pxPush *= scale;
        pyPush *= scale;
      }
      velWX[id] = (velWX[id] ?? 0) + pxPush;
      velWY[id] = (velWY[id] ?? 0) + pyPush;
    }
  };
}
