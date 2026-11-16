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
