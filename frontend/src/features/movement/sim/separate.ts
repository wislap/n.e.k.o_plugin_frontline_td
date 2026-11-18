// Uniform-grid separation: pairwise overlap resolution on a fixed 2-cell
// bucket grid (design §7.3). Buffers are reused every tick and never
// reallocated (ADR 0020).
import type { ComponentWriter, SystemContext } from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import { Mover, Position } from './components';

// Separation bucket size in cells.
const BUCKET = 2;
// Extra breathing room between units on top of both radii. Adjacent slot
// cells are 1 apart, so 0.35+0.35+0.2 still fits.
const SEPARATION_GAP = 0.2;
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

type VelWriter = ComponentWriter<{ x: 'f64'; y: 'f64' }>;

export function makeSeparate(terrain: TerrainApi, velW: () => VelWriter) {
  // Bucket key -> slot indices into the query result (ascending id order,
  // since the query returns sorted ids and buckets are filled in that
  // order). Arrays are emptied, never reallocated.
  const buckets = new Map<number, number[]>();
  let pushX = new Float64Array(64);
  let pushY = new Float64Array(64);
  const bucketCols = Math.ceil(terrain.width / BUCKET);

  function bucketOf(cx: number, cy: number): number {
    const bx = Math.min(Math.floor(cx / BUCKET), bucketCols - 1);
    const by = Math.floor(cy / BUCKET);
    return by * bucketCols + bx;
  }

  return function separate(ctx: SystemContext): void {
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
    const vel = ctx.write(velW());
    for (let slot = 0; slot < ids.length; slot++) {
      const id = ids[slot] ?? 0;
      vel.x[id] = (vel.x[id] ?? 0) + (pushX[slot] ?? 0);
      vel.y[id] = (vel.y[id] ?? 0) + (pushY[slot] ?? 0);
    }
  };
}
