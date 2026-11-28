// Pure merged-terrain geometry builder (M2 C2): per-cell top quads at the
// cell height, sloped quads on ramp cells towards the higher neighbour,
// and vertical cliff faces where a neighbour is lower. Produces
// position/index arrays; the component turns them into a three
// BufferGeometry.
import { HEIGHT_STEP } from '../../../client/world';

export interface TerrainGeometryData {
  positions: Float32Array;
  indices: Uint32Array;
}

type Corner = readonly [number, number, number];
type QuadCorners = readonly [Corner, Corner, Corner, Corner];

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
  indices: Uint32Array,
  cursor: QuadCursor,
  corners: QuadCorners,
): void {
  const base = cursor.v / 3;
  for (let k = 0; k < 4; k++) {
    const corner = corners[k];
    if (corner === undefined) {
      continue;
    }
    positions[cursor.v] = corner[0];
    positions[cursor.v + 1] = corner[1];
    positions[cursor.v + 2] = corner[2];
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
  ramps: ArrayLike<number>,
): TerrainGeometryData {
  // Up to 1 top/ramp quad + 4 cliff quads per cell.
  const maxQuads = width * height * 5;
  const positions = new Float32Array(maxQuads * 4 * 3);
  const indices = new Uint32Array(maxQuads * 6);
  const cursor: QuadCursor = { v: 0, i: 0 };

  const pushQuad = (corners: QuadCorners): void => {
    writeQuad(positions, indices, cursor, corners);
  };

  const heightAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : (heights[y * width + x] ?? 0);

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const idx = cy * width + cx;
      const hLevel = heights[idx] ?? 0;
      const h = hLevel * HEIGHT_STEP;
      const ch = cellCornerHeights(cx, cy, width, height, heights, ramps);

      if (ch.isRamp) {
        pushQuad([
          [cx, ch.nw, cy],
          [cx, ch.sw, cy + 1],
          [cx + 1, ch.se, cy + 1],
          [cx + 1, ch.ne, cy],
        ]);
      } else {
        pushQuad([
          [cx, h, cy],
          [cx, h, cy + 1],
          [cx + 1, h, cy + 1],
          [cx + 1, h, cy],
        ]);
      }

      // Cliff faces towards each lower neighbour.
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
        pushQuad(face);
      }
    }
  }

  return {
    positions: positions.subarray(0, cursor.v),
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
      indices: new Uint32Array(0),
    };
  }
  const s = skirtCells;
  const nx = width + s * 2;
  const ny = height + s * 2;
  // Grid nodes indexed (iy * (nx + 1) + ix); -1 = unused.
  const nodeIndex = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const positions: number[] = [];
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

  const emitNode = (ix: number, iy: number): number => {
    const key = iy * (nx + 1) + ix;
    let idx = nodeIndex[key] ?? -1;
    if (idx >= 0) {
      return idx;
    }
    const y = nodeY(ix, iy);
    idx = positions.length / 3;
    positions.push(ix - s, y, iy - s);
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
    indices: new Uint32Array(indices),
  };
}
