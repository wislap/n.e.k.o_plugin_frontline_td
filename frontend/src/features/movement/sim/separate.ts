// Uniform-grid separation: pairwise overlap resolution on a fixed 2-cell
// bucket grid (ADR 0053, ADR 0056). Uses two-slope overdamped repulsion,
// mass × state asymmetric yielding, same-direction longitudinal rear-unit
// yielding + one-sided overtake slip, tangential wrapping, and per-tick
// push clamping. Buffers are reused every tick and never reallocated (ADR 0020).
import type { ComponentWriter, SystemContext } from '../../../kernel/index';
import { Faction } from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { MoveTarget, Mover, Position, Velocity } from './components';

// Separation bucket size in cells.
const BUCKET = 2;
// Breathing buffer outside summed radii; soft repulsion resolves light
// grazing before core penetration engages.
const SEPARATION_GAP = 0.08;
const CONTAGIOUS_GAP = 0.16;
const CONTAGIOUS_TARGET_DIST_SQ = 4.8 * 4.8;
// Two-slope overdamped stiffnesses (buffer vs core penetration).
const SOFT_STIFFNESS = 0.25;
const CORE_STIFFNESS = 0.65;
// Same-faction state weights for asymmetric yielding (w = r^2 * stateWeight).
const STATE_MOVING_WEIGHT = 2.5;
const STATE_STOPPED_WEIGHT = 1.8;
const STATE_HOLDING_WEIGHT = 0.6;
// Maximum mass multiplier on the leading unit in a same-direction moving pair.
const FRONT_MOVER_MAX_MULT = 3.5;
// Tangential wrap coefficients (oncoming/static vs overtaking rear unit).
const WRAP_FACTOR = 0.6;
const OVERTAKE_WRAP_FACTOR = 0.35;
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
  let blockedByHolder = new Uint8Array(64);

  function separate(ctx: SystemContext): void {
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
    const tgtX = target.x;
    const tgtY = target.y;

    if (pushX.length < count) {
      pushX = new Float64Array(count * 2);
      pushY = new Float64Array(count * 2);
      next = new Int32Array(count * 2);
    }
    if (blockedByHolder.length < posX.length) {
      blockedByHolder = new Uint8Array(posX.length * 2);
    }
    blockedByHolder.fill(0);
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
      const id = ids[slot] as number;
      const bx = Math.min(Math.floor((posX[id] as number) / BUCKET), bucketCols - 1);
      const by = Math.floor((posY[id] as number) / BUCKET);
      const key = by * bucketCols + bx;
      if (bx >= 0 && key >= 0 && key < totalBuckets) {
        next[slot] = head[key] as number;
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
      const b = ids[other] as number;
      const br = moverR[b] as number;
      const ddx = (posX[b] as number) - ax;
      const ddy = (posY[b] as number) - ay;
      const touchDist = ar + br + CONTAGIOUS_GAP;
      if (Math.abs(ddx) >= touchDist || Math.abs(ddy) >= touchDist) {
        return;
      }
      const distSq = ddx * ddx + ddy * ddy;
      const fb = facId[b] as number;
      const sameFaction = fa !== 0 && fa === fb;
      const actB = tgtActive[b] as number;
      if (sameFaction && ((actA === 1 && actB === 2) || (actB === 1 && actA === 2))) {
        if (distSq <= touchDist * touchDist) {
          const moverId = actA === 1 ? a : b;
          const holderId = actA === 1 ? b : a;
          const tdx = (tgtX[moverId] ?? 0) - (tgtX[holderId] ?? 0);
          const tdy = (tgtY[moverId] ?? 0) - (tgtY[holderId] ?? 0);
          if (tdx * tdx + tdy * tdy <= CONTAGIOUS_TARGET_DIST_SQ) {
            const mx = posX[moverId] ?? 0;
            const my = posY[moverId] ?? 0;
            const hx = posX[holderId] ?? 0;
            const hy = posY[holderId] ?? 0;
            const fwdDot =
              (hx - mx) * ((tgtX[moverId] ?? 0) - mx) + (hy - my) * ((tgtY[moverId] ?? 0) - my);
            if (fwdDot > 0) {
              blockedByHolder[moverId] = 1;
            }
          }
        }
      }
      const maxDist = ar + br + SEPARATION_GAP;
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
      const vbx = actB === 1 || actA === 1 ? (velRX[b] as number) : 0;
      const vby = actB === 1 || actA === 1 ? (velRY[b] as number) : 0;
      let wMassA = sameFaction ? ma * stateWeight(actA) : ma;
      let wMassB = sameFaction ? mb * stateWeight(actB) : mb;
      let cosLong = 0;
      let sameDirLong = false;
      if (sameFaction && actA === 1 && actB === 1) {
        const vDot = vax * vbx + vay * vby;
        if (vDot > 0) {
          const mx = vax + vbx;
          const my = vay + vby;
          const mLenSq = mx * mx + my * my;
          if (mLenSq > 1e-8) {
            cosLong = (ux * mx + uy * my) / Math.sqrt(mLenSq);
            const absCos = Math.abs(cosLong);
            if (absCos > 0.25) {
              sameDirLong = true;
              const mult = 1 + (FRONT_MOVER_MAX_MULT - 1) * ((absCos - 0.25) / 0.75);
              if (cosLong > 0) {
                wMassB *= mult;
              } else {
                wMassA *= mult;
              }
            }
          }
        }
      }
      const invTotal = 1 / (wMassA + wMassB);
      // Lighter / yielding unit absorbs larger share.
      const shareA = wMassB * invTotal;
      const shareB = wMassA * invTotal;

      let pax = (pushX[slot] as number) - ux * impulse * shareA;
      let pay = (pushY[slot] as number) - uy * impulse * shareA;
      let pbx = (pushX[other] as number) + ux * impulse * shareB;
      let pby = (pushY[other] as number) + uy * impulse * shareB;

      if (actA === 1 || actB === 1) {
        const tx = -uy;
        const ty = ux;
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
          if (sameDirLong) {
            if (dotA - dotB > 1e-4) {
              if (cosLong > 0) {
                const sideA = vax * tx + vay * ty;
                const sA =
                  Math.abs(sideA) > 1e-6 ? (sideA > 0 ? 1 : -1) : (a + b) % 2 === 0 ? 1 : -1;
                const wrapA = sA * shareA * impulse * OVERTAKE_WRAP_FACTOR;
                pax += wrapA * tx;
                pay += wrapA * ty;
              } else {
                const sideB = vbx * tx + vby * ty;
                const sB =
                  Math.abs(sideB) > 1e-6 ? (sideB > 0 ? 1 : -1) : (a + b) % 2 === 0 ? 1 : -1;
                const wrapB = sB * shareB * impulse * OVERTAKE_WRAP_FACTOR;
                pbx += wrapB * tx;
                pby += wrapB * ty;
              }
            }
          } else if (actA === 1 && actB !== 1 && dotA > 0) {
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
      const a = ids[slot] as number;
      const ax = posX[a] as number;
      const ay = posY[a] as number;
      const ar = moverR[a] as number;
      const ma = Math.max(ar * ar, 0.01);
      const fa = facId[a] as number;
      const actA = tgtActive[a] as number;
      const vax = velRX[a] as number;
      const vay = velRY[a] as number;
      const bx = Math.floor(ax / BUCKET);
      const by = Math.floor(ay / BUCKET);
      for (let n = 0; n < 9; n++) {
        const nbKey = (by + (NB_DY[n] as number)) * bucketCols + bx + (NB_DX[n] as number);
        if (nbKey >= 0 && nbKey < totalBuckets) {
          let other = head[nbKey] as number;
          while (other !== -1) {
            resolvePair(slot, other, a, ax, ay, ar, ma, fa, actA, vax, vay);
            other = next[other] as number;
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
      let pxPush = pushX[slot] as number;
      let pyPush = pushY[slot] as number;
      if (pxPush === 0 && pyPush === 0) {
        continue;
      }
      const id = ids[slot] as number;
      const maxPush = Math.max(MIN_MAX_PUSH, (moverSpeed[id] as number) * MAX_PUSH_SPEED_FACTOR);
      const magSq = pxPush * pxPush + pyPush * pyPush;
      if (magSq > maxPush * maxPush) {
        const scale = maxPush / Math.sqrt(magSq);
        pxPush *= scale;
        pyPush *= scale;
      }
      velWX[id] = (velWX[id] as number) + pxPush;
      velWY[id] = (velWY[id] as number) + pyPush;
    }
  }

  return {
    run: separate,
    blockedByHolder: () => blockedByHolder,
    saveBlocked(): number[] {
      const idsOut: number[] = [];
      for (let id = 0; id < blockedByHolder.length; id++) {
        if ((blockedByHolder[id] ?? 0) === 1) {
          idsOut.push(id);
        }
      }
      return idsOut;
    },
    loadBlocked(idsIn: readonly number[]): void {
      let maxId = -1;
      for (let i = 0; i < idsIn.length; i++) {
        const id = idsIn[i] ?? 0;
        if (id > maxId) {
          maxId = id;
        }
      }
      if (maxId >= blockedByHolder.length) {
        blockedByHolder = new Uint8Array(maxId + 1);
      }
      blockedByHolder.fill(0);
      for (let i = 0; i < idsIn.length; i++) {
        blockedByHolder[idsIn[i] ?? 0] = 1;
      }
    },
  };
}
