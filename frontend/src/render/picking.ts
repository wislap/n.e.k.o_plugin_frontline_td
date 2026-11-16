// Ground picking (M2 C6): ray-march the height grid at 0.25-cell steps,
// then bisect six times. Exact when the camera looks straight down
// (tactical), height-aware for the pitched spectate camera. Pure over the
// ray and the height grid so it is unit-testable.
import { HEIGHT_STEP } from './world';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

const MARCH_STEP = 0.25;
const BISECT_ITERATIONS = 6;

export function pickGround(
  ray: Ray,
  heights: ArrayLike<number>,
  width: number,
  height: number,
  heightStep: number = HEIGHT_STEP,
): { x: number; y: number } | null {
  const horiz = Math.hypot(ray.dir.x, ray.dir.z);
  // A ray with no horizontal or downward component can never cross the
  // height field.
  if (ray.dir.y >= 0 && horiz === 0) {
    return null;
  }
  const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
  if (len === 0) {
    return null;
  }
  const dt = horiz > 0 ? MARCH_STEP / (horiz / len) : MARCH_STEP;
  // March at most until the ray reaches y=0 (terrain is never lower) or
  // has crossed the whole map horizontally, whichever comes first.
  const tExitY = ray.dir.y < 0 ? -ray.origin.y / ray.dir.y : Number.POSITIVE_INFINITY;
  const originDist = Math.hypot(ray.origin.x - width / 2, ray.origin.z - height / 2);
  const tExitX =
    horiz > 0 ? (originDist + Math.hypot(width, height)) / horiz : Number.POSITIVE_INFINITY;
  const maxT = Math.min(tExitY, tExitX) + dt;

  const heightAt = (px: number, pz: number): number | null => {
    const cx = Math.floor(px);
    const cy = Math.floor(pz);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      return null;
    }
    return (heights[cy * width + cx] ?? 0) * heightStep;
  };

  let prevT = 0;
  for (let t = dt; t <= maxT; t += dt) {
    const px = ray.origin.x + ray.dir.x * t;
    const py = ray.origin.y + ray.dir.y * t;
    const pz = ray.origin.z + ray.dir.z * t;
    const ground = heightAt(px, pz);
    if (ground === null) {
      // Outside the map (the ray may start or re-enter from outside);
      // maxT bounds the march either way.
      prevT = t;
      continue;
    }
    if (py <= ground) {
      // Crossed the surface between prevT and t; refine by bisection.
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < BISECT_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        const mx = ray.origin.x + ray.dir.x * mid;
        const my = ray.origin.y + ray.dir.y * mid;
        const mz = ray.origin.z + ray.dir.z * mid;
        const g = heightAt(mx, mz);
        if (g !== null && my <= g) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      const fx = ray.origin.x + ray.dir.x * hi;
      const fz = ray.origin.z + ray.dir.z * hi;
      return { x: fx, y: fz };
    }
    prevT = t;
  }
  return null;
}
