// Centralized snapshot/map → scene coordinate mapping (M2 C1).
// Scene X = map x, scene Z = map y, scene Y = height level * HEIGHT_STEP.
// North (map y = 0) is screen-up, which is scene -Z.
export const HEIGHT_STEP = 0.5;

export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

export function cellToScene(cx: number, cy: number, heightLevel: number): ScenePoint {
  return { x: cx, y: heightLevel * HEIGHT_STEP, z: cy };
}

export function heightLevelAt(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): number | null {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }
  return heights[y * width + x] ?? null;
}

// Scene Y of the terrain surface at fractional cell coordinates (nearest
// cell — used for unit placement and markers).
export function terrainY(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const level = heightLevelAt(heights, width, height, Math.floor(x), Math.floor(y)) ?? 0;
  return level * HEIGHT_STEP;
}

export interface CameraElevationField {
  readonly width: number;
  readonly height: number;
  readonly baseY: number;
  readonly smoothY: Float32Array;
}

const DEFAULT_ELEVATION_BLUR_RADIUS = 6;
const elevationFieldCache = new WeakMap<object, CameraElevationField>();

function blurPassHorizontal(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius <= 0) {
    dst.set(src);
    return;
  }
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const cx = Math.min(width - 1, Math.max(0, k));
      sum += src[row + cx] ?? 0;
    }
    dst[row] = sum / span;
    for (let x = 1; x < width; x++) {
      const addX = Math.min(width - 1, x + radius);
      const subX = Math.max(0, x - 1 - radius);
      sum += (src[row + addX] ?? 0) - (src[row + subX] ?? 0);
      dst[row + x] = sum / span;
    }
  }
}

function blurPassVertical(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius <= 0) {
    dst.set(src);
    return;
  }
  const span = radius * 2 + 1;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const cy = Math.min(height - 1, Math.max(0, k));
      sum += src[cy * width + x] ?? 0;
    }
    dst[x] = sum / span;
    for (let y = 1; y < height; y++) {
      const addY = Math.min(height - 1, y + radius);
      const subY = Math.max(0, y - 1 - radius);
      sum += (src[addY * width + x] ?? 0) - (src[subY * width + x] ?? 0);
      dst[y * width + x] = sum / span;
    }
  }
}

export function buildCameraElevationField(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  blurRadius: number = DEFAULT_ELEVATION_BLUR_RADIUS,
): CameraElevationField {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0, baseY: 0, smoothY: new Float32Array(0) };
  }
  const count = width * height;
  const bufA = new Float32Array(count);
  const bufB = new Float32Array(count);
  let totalY = 0;
  for (let i = 0; i < count; i++) {
    const y = (heights[i] ?? 0) * HEIGHT_STEP;
    bufA[i] = y;
    totalY += y;
  }
  const baseY = totalY / count;
  const r = Math.max(0, Math.floor(blurRadius));
  // Two separable box-blur passes produce a smooth 2D tent filter across (4r+1)^2 cells.
  blurPassHorizontal(bufA, bufB, width, height, r);
  blurPassVertical(bufB, bufA, width, height, r);
  blurPassHorizontal(bufA, bufB, width, height, r);
  blurPassVertical(bufB, bufA, width, height, r);
  return { width, height, baseY, smoothY: bufA };
}

export function getCameraElevationField(
  heights: ArrayLike<number>,
  width: number,
  height: number,
): CameraElevationField {
  const cached = elevationFieldCache.get(heights);
  if (cached !== undefined && cached.width === width && cached.height === height) {
    return cached;
  }
  const built = buildCameraElevationField(heights, width, height);
  elevationFieldCache.set(heights, built);
  return built;
}

export function sampleCameraElevation(field: CameraElevationField, x: number, y: number): number {
  if (field.width <= 0 || field.height <= 0 || field.smoothY.length === 0) {
    return 0;
  }
  const gx = Math.min(field.width - 1, Math.max(0, x - 0.5));
  const gy = Math.min(field.height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const w = field.width;
  const h00 = field.smoothY[y0 * w + x0] ?? field.baseY;
  const h10 = field.smoothY[y0 * w + x1] ?? field.baseY;
  const h01 = field.smoothY[y1 * w + x0] ?? field.baseY;
  const h11 = field.smoothY[y1 * w + x1] ?? field.baseY;
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fy;
}
