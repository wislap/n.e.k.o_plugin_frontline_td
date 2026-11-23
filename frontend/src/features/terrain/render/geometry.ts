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
const SKIRT_BOTTOM_Y = -1.4;
const SKIRT_TOP_COLOR: Rgb = parseHexColor('#1c2638');
const SKIRT_BOT_COLOR: Rgb = parseHexColor('#0b1020');

// Ramp cells slope towards the first higher neighbour in this fixed order
// (east, south, west, north) — deterministic, mirrors the terrain rule.
const RAMP_DIRS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
] as const;

interface QuadCursor {
  v: number;
  i: number;
}

function writeQuad(
  positions: Float32Array,
  colors: Float32Array,
  indices: Uint32Array,
  cursor: QuadCursor,
  corners: QuadCorners,
  quadColors: readonly [Rgb, Rgb, Rgb, Rgb],
  shades: QuadShades,
): void {
  const base = cursor.v / 3;
  for (let k = 0; k < 4; k++) {
    const corner = corners[k];
    const color = quadColors[k];
    const shade = shades[k];
    if (corner === undefined || color === undefined || shade === undefined) {
      continue;
    }
    positions[cursor.v] = corner[0];
    positions[cursor.v + 1] = corner[1];
    positions[cursor.v + 2] = corner[2];
    colors[cursor.v] = Math.min(1, color.r * shade);
    colors[cursor.v + 1] = Math.min(1, color.g * shade);
    colors[cursor.v + 2] = Math.min(1, color.b * shade);
    cursor.v += 3;
  }
  indices[cursor.i] = base;
  indices[cursor.i + 1] = base + 1;
  indices[cursor.i + 2] = base + 2;
  indices[cursor.i + 3] = base;
  indices[cursor.i + 4] = base + 2;
  indices[cursor.i + 5] = base + 3;
  cursor.i += 6;
}

function cellCornerHeights(
  cx: number,
  cy: number,
  width: number,
  height: number,
  heights: ArrayLike<number>,
  ramps: ArrayLike<number>,
): { nw: number; sw: number; se: number; ne: number; isRamp: boolean } {
  const idx = cy * width + cx;
  const hLevel = heights[idx] ?? 0;
  const h = hLevel * HEIGHT_STEP;
  const isRamp = (ramps[idx] ?? 0) === 1;
  if (!isRamp) {
    return { nw: h, sw: h, se: h, ne: h, isRamp: false };
  }
  let dir: { dx: number; dy: number } = RAMP_DIRS[0];
  for (const d of RAMP_DIRS) {
    const nx = cx + d.dx;
    const ny = cy + d.dy;
    const nh =
      nx < 0 || ny < 0 || nx >= width || ny >= height ? -1 : (heights[ny * width + nx] ?? 0);
    if (nh === hLevel + 1) {
      dir = d;
      break;
    }
  }
  const hi = h + HEIGHT_STEP;
  if (dir.dx === 1) {
    return { nw: h, sw: h, se: hi, ne: hi, isRamp: true };
  }
  if (dir.dx === -1) {
    return { nw: hi, sw: hi, se: h, ne: h, isRamp: true };
  }
  if (dir.dy === 1) {
    return { nw: h, sw: hi, se: hi, ne: h, isRamp: true };
  }
  return { nw: hi, sw: h, se: h, ne: hi, isRamp: true };
}

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
  const cursor: QuadCursor = { v: 0, i: 0 };

  const pushQuad = (corners: QuadCorners, color: Rgb, shades: QuadShades): void => {
    writeQuad(positions, colors, indices, cursor, corners, [color, color, color, color], shades);
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
      const ch = cellCornerHeights(cx, cy, width, height, heights, ramps);

      if (ch.isRamp) {
        const hi = h + HEIGHT_STEP;
        const corners: QuadCorners = [
          [cx, ch.nw, cy],
          [cx, ch.sw, cy + 1],
          [cx + 1, ch.se, cy + 1],
          [cx + 1, ch.ne, cy],
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
    positions: positions.subarray(0, cursor.v),
    colors: colors.subarray(0, cursor.v),
    indices: indices.subarray(0, cursor.i),
  };
}

// Solid dark slate pedestal walls framing the four map borders so low-pitch
// 360° camera orbits read as a solid carved tactical sandbox table.
export function buildTerrainSkirtGeometry(
  width: number,
  height: number,
  heights: ArrayLike<number>,
  ramps: ArrayLike<number>,
): TerrainGeometryData {
  if (width <= 0 || height <= 0) {
    return {
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
    };
  }
  const quadCount = width * 2 + height * 2;
  const positions = new Float32Array(quadCount * 4 * 3);
  const colors = new Float32Array(quadCount * 4 * 3);
  const indices = new Uint32Array(quadCount * 6);
  const cursor: QuadCursor = { v: 0, i: 0 };
  const skirtColors: readonly [Rgb, Rgb, Rgb, Rgb] = [
    SKIRT_TOP_COLOR,
    SKIRT_TOP_COLOR,
    SKIRT_BOT_COLOR,
    SKIRT_BOT_COLOR,
  ];
  const shades: QuadShades = [1, 1, 1, 1];
  const bot = SKIRT_BOTTOM_Y;

  for (let cx = 0; cx < width; cx++) {
    const north = cellCornerHeights(cx, 0, width, height, heights, ramps);
    writeQuad(
      positions,
      colors,
      indices,
      cursor,
      [
        [cx, north.nw, 0],
        [cx + 1, north.ne, 0],
        [cx + 1, bot, 0],
        [cx, bot, 0],
      ],
      skirtColors,
      shades,
    );

    const south = cellCornerHeights(cx, height - 1, width, height, heights, ramps);
    writeQuad(
      positions,
      colors,
      indices,
      cursor,
      [
        [cx + 1, south.se, height],
        [cx, south.sw, height],
        [cx, bot, height],
        [cx + 1, bot, height],
      ],
      skirtColors,
      shades,
    );
  }

  for (let cy = 0; cy < height; cy++) {
    const west = cellCornerHeights(0, cy, width, height, heights, ramps);
    writeQuad(
      positions,
      colors,
      indices,
      cursor,
      [
        [0, west.sw, cy + 1],
        [0, west.nw, cy],
        [0, bot, cy],
        [0, bot, cy + 1],
      ],
      skirtColors,
      shades,
    );

    const east = cellCornerHeights(width - 1, cy, width, height, heights, ramps);
    writeQuad(
      positions,
      colors,
      indices,
      cursor,
      [
        [width, east.ne, cy],
        [width, east.se, cy + 1],
        [width, bot, cy + 1],
        [width, bot, cy],
      ],
      skirtColors,
      shades,
    );
  }

  return {
    positions: positions.subarray(0, cursor.v),
    colors: colors.subarray(0, cursor.v),
    indices: indices.subarray(0, cursor.i),
  };
}

// Out-of-bounds terrain skirt (visual-languages): a ring of rolling noise
// hills beyond the map rect so themed worlds sit in a landscape instead of
// on a floating table. Heights blend from the nearest border cell into
// deterministic hills that sink below the platform at the outer rim; the
// horizon haze hides the join. Render-only — never pickable.
function outskirtsHash(x: number, y: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function outskirtsNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = outskirtsHash(ix, iy);
  const b = outskirtsHash(ix + 1, iy);
  const c = outskirtsHash(ix, iy + 1);
  const d = outskirtsHash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const SKIRT_SINK_Y = -1.6;
const SKIRT_SHADE_LOW = 0.9;
const SKIRT_SHADE_HIGH = 1.05;

export function buildOutskirtsGeometry(
  width: number,
  height: number,
  heights: ArrayLike<number>,
  ramps: ArrayLike<number>,
  skirtCells: number,
): TerrainGeometryData {
  if (width <= 0 || height <= 0 || skirtCells <= 0) {
    return {
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
    };
  }
  const s = skirtCells;
  const nx = width + s * 2;
  const ny = height + s * 2;
  // Grid nodes indexed (iy * (nx + 1) + ix); -1 = unused.
  const nodeIndex = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Height on the map boundary itself: bilinear over the edge cell's real
  // corner heights (cellCornerHeights) so ramp border cells — whose outer
  // corners sit a full step above the cell level — meet the skirt with no
  // vertical step. Without this the mismatch painted a lit cliff band.
  const edgeH = (x: number, y: number): number => {
    const bx = Math.min(Math.max(x, 0), width);
    const by = Math.min(Math.max(y, 0), height);
    const cx = Math.min(Math.floor(bx), width - 1);
    const cy = Math.min(Math.floor(by), height - 1);
    const fx = bx - cx;
    const fy = by - cy;
    const c = cellCornerHeights(cx, cy, width, height, heights, ramps);
    const north = c.nw + (c.ne - c.nw) * fx;
    const south = c.sw + (c.se - c.sw) * fx;
    return north + (south - north) * fy;
  };
  const distOutside = (x: number, y: number): number => Math.max(-x, x - width, -y, y - height, 0);

  const nodeY = (ix: number, iy: number): number => {
    const x = ix - s;
    const y = iy - s;
    const d = distOutside(x, y);
    // Continue the terrain's edge slope outward for a few cells instead of
    // clamping to the border height: a flat clamp against a sloped border
    // cell creases the shading at the seam (a lit lip along the edge).
    const bx = Math.min(Math.max(x, 0), width);
    const by = Math.min(Math.max(y, 0), height);
    let base = edgeH(bx, by);
    if (d > 0) {
      const ux = (x - bx) / d;
      const uy = (y - by) / d;
      const slope = edgeH(bx, by) - edgeH(bx - ux, by - uy);
      base += slope * d * Math.max(0, 1 - d / 4);
    }
    const rim = 1 - Math.min(Math.max((d / s - 0.75) / 0.25, 0), 1);
    const amp = Math.min(d * 0.45, 1.7);
    // First ~3 cells hold the border height so the skirt meets the map
    // edge with no ledge, then rolling noise fades in.
    const hills =
      (outskirtsNoise(x * 0.09, y * 0.09) * 0.62 +
        outskirtsNoise(x * 0.31, y * 0.31) * 0.38 -
        0.5) *
      amp *
      rim *
      Math.min(Math.max((d - 1) / 2, 0), 1);
    const sink = Math.min(Math.max((d / s - 0.82) / 0.18, 0), 1) * (base - SKIRT_SINK_Y + 0.5);
    // The outermost in-map ring is drawn by this skirt too (see the quad
    // test below) and must tuck just under the terrain surface so the two
    // meshes overlap without z-fighting: no sub-pixel crack can show sky.
    const strictlyInside = x > 0 && y > 0 && x < width && y < height;
    return base + hills - sink - (strictlyInside ? 0.035 : 0);
  };

  const nodeShade = (ix: number, iy: number, y: number): number => {
    const n = outskirtsNoise(ix * 0.7 + 3.1, iy * 0.7 + 9.7);
    const hMix = Math.min(Math.max(y * 0.35 + 0.55, 0), 1);
    return (SKIRT_SHADE_LOW + (SKIRT_SHADE_HIGH - SKIRT_SHADE_LOW) * hMix) * (0.94 + n * 0.12);
  };

  const emitNode = (ix: number, iy: number): number => {
    const key = iy * (nx + 1) + ix;
    let idx = nodeIndex[key] ?? -1;
    if (idx >= 0) {
      return idx;
    }
    const y = nodeY(ix, iy);
    const shade = nodeShade(ix, iy, y);
    idx = positions.length / 3;
    positions.push(ix - s, y, iy - s);
    colors.push(shade, shade, shade);
    nodeIndex[key] = idx;
    return idx;
  };

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      // Quad cells fully inside the map rect are covered by TerrainMesh —
      // except the outermost ring, which this skirt also draws (tucked
      // 0.035 under the terrain) so the mesh boundary overlaps instead of
      // cracking open to the sky at grazing angles.
      const x0 = ix - s;
      const y0 = iy - s;
      const inside = x0 >= 1 && y0 >= 1 && x0 < width - 1 && y0 < height - 1;
      if (inside) {
        continue;
      }
      const a = emitNode(ix, iy);
      const b = emitNode(ix, iy + 1);
      const c = emitNode(ix + 1, iy + 1);
      const d = emitNode(ix + 1, iy);
      indices.push(a, b, c, a, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}

// Diorama floating island: a tapered block under the map with soil/rock
// strata vertex colors banded on its sides (no top face — the terrain
// covers it). topY is the terrain edge height in world units so the rim
// tucks just under the map edge.
export function buildIslandGeometry(
  width: number,
  height: number,
  topY: number,
  depth: number,
  strata: readonly string[],
): { positions: Float32Array; colors: Float32Array; indices: Uint32Array } {
  const inset = Math.min(width, height) * 0.28;
  const bottomY = topY - depth;
  const strataRgb = strata.map(parseHexColor);
  const bandCount = Math.max(strataRgb.length, 1);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const emitVert = (x: number, y: number, z: number): number => {
    const band = Math.min(
      bandCount - 1,
      Math.max(0, Math.floor(((topY - y) / Math.max(depth, 1e-3)) * bandCount)),
    );
    const rgb = strataRgb[band] ?? { r: 0.5, g: 0.4, b: 0.3 };
    positions.push(x, y, z);
    colors.push(rgb.r, rgb.g, rgb.b);
    return positions.length / 3 - 1;
  };
  // Each wall is a column of bandCount strips so the strata read as
  // discrete soil/rock layers, each strip slightly more inset downward.
  const LIP = 0.5;
  const wall = (x0: number, z0: number, x1: number, z1: number, dx: number, dz: number): void => {
    const cx = width / 2;
    const cz = height / 2;
    const k = (inset / Math.min(width, height)) * 2.0;
    const lerp = (a: number, c: number, f: number): number => a + (c - a) * f * k;
    for (let b = 0; b < bandCount; b++) {
      const f0 = b / bandCount;
      const f1 = (b + 1) / bandCount;
      const y0 = topY - depth * f0;
      const y1 = topY - depth * f1;
      // The top band edge flares outward past the map rect so the wall
      // tucks under the terrain edge at every height.
      const mx0 = dx * LIP * (1 - f0);
      const mz0 = dz * LIP * (1 - f0);
      const mx1 = dx * LIP * (1 - f1);
      const mz1 = dz * LIP * (1 - f1);
      const a = emitVert(lerp(x0, cx, f0) + mx0, y0, lerp(z0, cz, f0) + mz0);
      const bb = emitVert(lerp(x1, cx, f0) + mx0, y0, lerp(z1, cz, f0) + mz0);
      const c = emitVert(lerp(x1, cx, f1) + mx1, y1, lerp(z1, cz, f1) + mz1);
      const d = emitVert(lerp(x0, cx, f1) + mx1, y1, lerp(z0, cz, f1) + mz1);
      indices.push(a, d, c, a, c, bb);
    }
  };
  wall(0, 0, width, 0, 0, -1);
  wall(width, 0, width, height, 1, 0);
  wall(width, height, 0, height, 0, 1);
  wall(0, height, 0, 0, -1, 0);
  // Bottom face — same shrink factor as the deepest wall band (f = 1).
  const k = (inset / Math.min(width, height)) * 2.0;
  const bx0 = (width / 2) * k;
  const bx1 = width * (1 - k / 2);
  const bz0 = (height / 2) * k;
  const bz1 = height * (1 - k / 2);
  const p0 = emitVert(bx0, bottomY, bz0);
  const p1 = emitVert(bx1, bottomY, bz0);
  const p2 = emitVert(bx1, bottomY, bz1);
  const p3 = emitVert(bx0, bottomY, bz1);
  indices.push(p0, p3, p2, p0, p2, p1);
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
