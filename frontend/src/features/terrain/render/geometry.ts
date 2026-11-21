// Pure merged-terrain geometry builder (M2 C2): per-cell top quads at the
// cell height, sloped quads on ramp cells towards the higher neighbour,
// and darker vertical cliff faces where a neighbour is lower. Produces
// position/color/index arrays; the component turns them into a three
// BufferGeometry.
import { HEIGHT_STEP } from '../../../render/world';

export interface TerrainGeometryData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

type Corner = readonly [number, number, number];
type QuadCorners = readonly [Corner, Corner, Corner, Corner];
type QuadShades = readonly [number, number, number, number];

export function parseHexColor(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

const ELEV_STEP_BOOST = 0.08;
const RIM_BOOST = 1.13;
const CLIFF_TOP_SHADE = 0.58;
const CLIFF_BOT_SHADE = 0.4;
const RAMP_LOW_SHADE = 0.86;
const RAMP_HIGH_SHADE = 1.18;
const RAMP_HIGH_ELEV_OFFSET = 0.06;
const CHECKER_LIGHT = 1.04;
const CHECKER_DARK = 0.96;

// Ramp cells slope towards the first higher neighbour in this fixed order
// (east, south, west, north) — deterministic, mirrors the terrain rule.
const RAMP_DIRS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
] as const;

export function buildTerrainGeometry(
  width: number,
  height: number,
  heights: ArrayLike<number>,
  surfaces: ArrayLike<number>,
  ramps: ArrayLike<number>,
  palette: readonly Rgb[],
): TerrainGeometryData {
  // Up to 1 top/ramp quad + 4 cliff quads per cell.
  const maxQuads = width * height * 5;
  const positions = new Float32Array(maxQuads * 4 * 3);
  const colors = new Float32Array(maxQuads * 4 * 3);
  const indices = new Uint32Array(maxQuads * 6);
  let v = 0;
  let i = 0;

  const pushQuad = (corners: QuadCorners, color: Rgb, shades: QuadShades): void => {
    const base = v / 3;
    for (let k = 0; k < 4; k++) {
      const corner = corners[k];
      const shade = shades[k];
      if (corner === undefined || shade === undefined) {
        continue;
      }
      positions[v] = corner[0];
      positions[v + 1] = corner[1];
      positions[v + 2] = corner[2];
      colors[v] = Math.min(1, color.r * shade);
      colors[v + 1] = Math.min(1, color.g * shade);
      colors[v + 2] = Math.min(1, color.b * shade);
      v += 3;
    }
    indices[i] = base;
    indices[i + 1] = base + 1;
    indices[i + 2] = base + 2;
    indices[i + 3] = base;
    indices[i + 4] = base + 2;
    indices[i + 5] = base + 3;
    i += 6;
  };

  const heightAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : (heights[y * width + x] ?? 0);

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const idx = cy * width + cx;
      const hLevel = heights[idx] ?? 0;
      const h = hLevel * HEIGHT_STEP;
      const elevBoost = 1 + hLevel * ELEV_STEP_BOOST;
      const baseColor = palette[surfaces[idx] ?? 0] ?? { r: 0.5, g: 0.5, b: 0.5 };
      const checker = (cx + cy) % 2 === 0 ? CHECKER_LIGHT : CHECKER_DARK;

      const isRamp = (ramps[idx] ?? 0) === 1;
      if (isRamp) {
        // Slope towards the higher neighbour: the edge facing it rises one
        // height step.
        let dir: { dx: number; dy: number } = RAMP_DIRS[0];
        for (const d of RAMP_DIRS) {
          if (heightAt(cx + d.dx, cy + d.dy) === hLevel + 1) {
            dir = d;
            break;
          }
        }
        const hi = h + HEIGHT_STEP;
        // Counter-clockwise seen from above so the face normal is +Y.
        const corners: QuadCorners =
          dir.dx === 1
            ? [
                [cx, h, cy],
                [cx, h, cy + 1],
                [cx + 1, hi, cy + 1],
                [cx + 1, hi, cy],
              ]
            : dir.dx === -1
              ? [
                  [cx, hi, cy],
                  [cx, hi, cy + 1],
                  [cx + 1, h, cy + 1],
                  [cx + 1, h, cy],
                ]
              : dir.dy === 1
                ? [
                    [cx, h, cy],
                    [cx, hi, cy + 1],
                    [cx + 1, hi, cy + 1],
                    [cx + 1, h, cy],
                  ]
                : [
                    [cx, hi, cy],
                    [cx, h, cy + 1],
                    [cx + 1, h, cy + 1],
                    [cx + 1, hi, cy],
                  ];
        const lowShade = RAMP_LOW_SHADE * elevBoost;
        const highShade = RAMP_HIGH_SHADE * (elevBoost + RAMP_HIGH_ELEV_OFFSET);
        const s = (c: Corner): number => (c[1] === hi ? highShade : lowShade);
        pushQuad(corners, baseColor, [s(corners[0]), s(corners[1]), s(corners[2]), s(corners[3])]);
      } else {
        const cornerShade = (dx: number, dy: number): number => {
          const nx = heightAt(cx + dx, cy);
          const ny = heightAt(cx, cy + dy);
          const drops = (nx >= 0 && nx < hLevel) || (ny >= 0 && ny < hLevel);
          return checker * elevBoost * (drops ? RIM_BOOST : 1);
        };
        pushQuad(
          [
            [cx, h, cy],
            [cx, h, cy + 1],
            [cx + 1, h, cy + 1],
            [cx + 1, h, cy],
          ],
          baseColor,
          [cornerShade(-1, -1), cornerShade(-1, 1), cornerShade(1, 1), cornerShade(1, -1)],
        );
      }

      // Cliff faces towards each lower neighbour.
      const cliffTop = CLIFF_TOP_SHADE * elevBoost;
      const cliffBot = CLIFF_BOT_SHADE * elevBoost;
      const cliffShades: QuadShades = [cliffTop, cliffTop, cliffBot, cliffBot];
      for (const d of RAMP_DIRS) {
        const nh = heightAt(cx + d.dx, cy + d.dy);
        if (nh < 0 || nh >= hLevel) {
          continue;
        }
        const low = nh * HEIGHT_STEP;
        const face: QuadCorners =
          d.dx === 1
            ? [
                [cx + 1, h, cy],
                [cx + 1, h, cy + 1],
                [cx + 1, low, cy + 1],
                [cx + 1, low, cy],
              ]
            : d.dx === -1
              ? [
                  [cx, h, cy + 1],
                  [cx, h, cy],
                  [cx, low, cy],
                  [cx, low, cy + 1],
                ]
              : d.dy === 1
                ? [
                    [cx + 1, h, cy + 1],
                    [cx, h, cy + 1],
                    [cx, low, cy + 1],
                    [cx + 1, low, cy + 1],
                  ]
                : [
                    [cx, h, cy],
                    [cx + 1, h, cy],
                    [cx + 1, low, cy],
                    [cx, low, cy],
                  ];
        pushQuad(face, baseColor, cliffShades);
      }
    }
  }

  return {
    positions: positions.subarray(0, v),
    colors: colors.subarray(0, v),
    indices: indices.subarray(0, i),
  };
}
