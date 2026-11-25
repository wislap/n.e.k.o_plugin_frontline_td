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

// Generic ray math shared by the feature pick helpers (ADR 0062 step
// 4b): channel-agnostic, moved verbatim from client/pick-ray.ts.
export function normalizeRay(ray: Ray): Ray | null {
  const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
  if (len <= 0) {
    return null;
  }
  return {
    origin: ray.origin,
    dir: { x: ray.dir.x / len, y: ray.dir.y / len, z: ray.dir.z / len },
  };
}

export function surfaceHeightAt(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  heightStep: number,
): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
    return 0;
  }
  return (heights[cy * width + cx] ?? 0) * heightStep;
}

export function rayAabbHitT(
  ray: Ray,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  const axes: readonly [number, number, number, number][] = [
    [ray.origin.x, ray.dir.x, minX, maxX],
    [ray.origin.y, ray.dir.y, minY, maxY],
    [ray.origin.z, ray.dir.z, minZ, maxZ],
  ];
  for (const [o, d, bMin, bMax] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < bMin || o > bMax) {
        return null;
      }
      continue;
    }
    const inv = 1 / d;
    const t0 = (bMin - o) * inv;
    const t1 = (bMax - o) * inv;
    tMin = Math.max(tMin, Math.min(t0, t1));
    tMax = Math.min(tMax, Math.max(t0, t1));
    if (tMax < tMin) {
      return null;
    }
  }
  return tMin;
}

export function rayCylinderHitT(
  ray: Ray,
  cx: number,
  baseY: number,
  topY: number,
  cz: number,
  radius: number,
): number | null {
  let tYMin = Number.NEGATIVE_INFINITY;
  let tYMax = Number.POSITIVE_INFINITY;
  if (Math.abs(ray.dir.y) < 1e-9) {
    if (ray.origin.y < baseY || ray.origin.y > topY) {
      return null;
    }
  } else {
    const ty0 = (baseY - ray.origin.y) / ray.dir.y;
    const ty1 = (topY - ray.origin.y) / ray.dir.y;
    tYMin = Math.min(ty0, ty1);
    tYMax = Math.max(ty0, ty1);
  }

  const dx = ray.origin.x - cx;
  const dz = ray.origin.z - cz;
  const a = ray.dir.x * ray.dir.x + ray.dir.z * ray.dir.z;
  const c = dx * dx + dz * dz - radius * radius;
  if (a < 1e-10) {
    if (c > 0) {
      return null;
    }
    const enter = Math.max(0, tYMin);
    return tYMax < enter ? null : enter;
  }

  const b = 2 * (dx * ray.dir.x + dz * ray.dir.z);
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    return null;
  }
  const sqrtD = Math.sqrt(disc);
  const tCyl0 = (-b - sqrtD) / (2 * a);
  const tCyl1 = (-b + sqrtD) / (2 * a);
  const enter = Math.max(0, tCyl0, tYMin);
  const exit = Math.min(tCyl1, tYMax);
  return exit < enter ? null : enter;
}

export function groundMaxT(
  ray: Ray,
  groundHit: { x: number; y: number } | null,
  heights: ArrayLike<number>,
  mapDims: { width: number; height: number },
  heightStep: number,
): number {
  if (groundHit === null) {
    return Number.POSITIVE_INFINITY;
  }
  const gy = surfaceHeightAt(
    heights,
    mapDims.width,
    mapDims.height,
    groundHit.x,
    groundHit.y,
    heightStep,
  );
  return (
    Math.hypot(groundHit.x - ray.origin.x, gy - ray.origin.y, groundHit.y - ray.origin.z) + 0.35
  );
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
