import { describe, expect, it } from 'vitest';
import { buildTerrainGeometry, buildTerrainSkirtGeometry } from './geometry';

interface Vec {
  x: number;
  y: number;
  z: number;
}

function triNormal(positions: Float32Array, indices: Uint32Array, tri: number): Vec {
  const a = indices[tri * 3] ?? 0;
  const b = indices[tri * 3 + 1] ?? 0;
  const c = indices[tri * 3 + 2] ?? 0;
  const p = (v: number): Vec => ({
    x: positions[v * 3] ?? 0,
    y: positions[v * 3 + 1] ?? 0,
    z: positions[v * 3 + 2] ?? 0,
  });
  const pa = p(a);
  const pb = p(b);
  const pc = p(c);
  const e1 = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
  const e2 = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z };
  const n = {
    x: e1.y * e2.z - e1.z * e2.y,
    y: e1.z * e2.x - e1.x * e2.z,
    z: e1.x * e2.y - e1.y * e2.x,
  };
  const len = Math.hypot(n.x, n.y, n.z);
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

describe('terrain geometry winding', () => {
  it('top/ramp faces point up; cliff faces point horizontally at the lower neighbour', () => {
    // 5x5 map: plateau at (2,2) height 1, a ramp at (2,1) sloping up to it,
    // everything else flat height 0 — the plateau has a lower neighbour on
    // all four sides, so it emits one cliff face per direction.
    const width = 5;
    const height = 5;
    const heights = new Uint8Array(width * height);
    const surfaces = new Uint16Array(width * height);
    const ramps = new Uint8Array(width * height);
    heights[2 * width + 2] = 1;
    ramps[1 * width + 2] = 1;
    const geo = buildTerrainGeometry(width, height, heights, surfaces, ramps, [
      { r: 0.5, g: 0.5, b: 0.5 },
    ]);

    const triCount = geo.indices.length / 3;
    let upFaces = 0;
    const cliffDirs = new Map<string, number>();
    for (let t = 0; t < triCount; t++) {
      const n = triNormal(geo.positions, geo.indices, t);
      // No face may point downwards (back-face culling hides those).
      expect(n.y).toBeGreaterThanOrEqual(-1e-6);
      if (n.y > 0.01) {
        // Top or ramp quad: the normal has an upward component.
        upFaces += 1;
      } else {
        // Cliff quad: purely horizontal normal towards the lower neighbour.
        const key = `${Math.round(n.x)},${Math.round(n.z)}`;
        cliffDirs.set(key, (cliffDirs.get(key) ?? 0) + 1);
      }
    }

    // One top quad (two triangles) per cell.
    expect(upFaces).toBe(width * height * 2);
    // Four cliff quads around the plateau, one horizontal normal per side:
    // east +X, west -X, south +Z, north -Z.
    expect(cliffDirs.get('1,0')).toBe(2);
    expect(cliffDirs.get('-1,0')).toBe(2);
    expect(cliffDirs.get('0,1')).toBe(2);
    expect(cliffDirs.get('0,-1')).toBe(2);
    expect(cliffDirs.size).toBe(4);
  });

  it('ramp quads on every slope direction keep an upward normal', () => {
    // 4 ramps around a height-1 plateau column, each sloping towards it.
    const width = 5;
    const height = 5;
    const heights = new Uint8Array(width * height);
    const surfaces = new Uint16Array(width * height);
    const ramps = new Uint8Array(width * height);
    heights[2 * width + 2] = 1;
    for (const [rx, ry] of [
      [3, 2],
      [1, 2],
      [2, 3],
      [2, 1],
    ]) {
      ramps[(ry ?? 0) * width + (rx ?? 0)] = 1;
    }
    const geo = buildTerrainGeometry(width, height, heights, surfaces, ramps, [
      { r: 0.5, g: 0.5, b: 0.5 },
    ]);
    for (let t = 0; t < geo.indices.length / 3; t++) {
      expect(triNormal(geo.positions, geo.indices, t).y).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

describe('terrain tactical contrast & buffer sizing', () => {
  it('shades height-2 plateau brighter than height-0 ground', () => {
    const width = 4;
    const height = 4;
    const heights = new Uint8Array(width * height);
    const surfaces = new Uint16Array(width * height);
    const ramps = new Uint8Array(width * height);
    // 2x2 height-2 plateau at (2..3, 2..3), height-0 ground elsewhere.
    heights[2 * width + 2] = 2;
    heights[2 * width + 3] = 2;
    heights[3 * width + 2] = 2;
    heights[3 * width + 3] = 2;
    const geo = buildTerrainGeometry(width, height, heights, surfaces, ramps, [
      { r: 0.5, g: 0.5, b: 0.5 },
    ]);

    // First 4 vertices belong to cell (0,0) top quad at height 0.
    const groundR = geo.colors[0] ?? 0;
    // Find a top-quad vertex at y > 0 (plateau top).
    let plateauR = 0;
    for (let v = 0; v < geo.positions.length / 3; v++) {
      const y = geo.positions[v * 3 + 1] ?? 0;
      if (y > 0.5) {
        plateauR = Math.max(plateauR, geo.colors[v * 3] ?? 0);
      }
    }
    expect(plateauR).toBeGreaterThan(groundR);
  });

  it('shades ramp high-end vertices brighter than low-end vertices', () => {
    const width = 3;
    const height = 3;
    const heights = new Uint8Array(width * height);
    const surfaces = new Uint16Array(width * height);
    const ramps = new Uint8Array(width * height);
    heights[1 * width + 2] = 1;
    ramps[1 * width + 1] = 1; // Cell (1,1) slopes east towards (2,1).
    const geo = buildTerrainGeometry(width, height, heights, surfaces, ramps, [
      { r: 0.5, g: 0.5, b: 0.5 },
    ]);

    // Cell (1,1) is cell index 4, and cells 0..3 are flat height 0 with 0 cliffs,
    // so cell (1,1)'s quad starts at vertex index 16.
    const baseVert = 4 * 4;
    const ys = [0, 1, 2, 3].map((k) => geo.positions[(baseVert + k) * 3 + 1] ?? 0);
    const reds = [0, 1, 2, 3].map((k) => geo.colors[(baseVert + k) * 3] ?? 0);
    const maxY = Math.max(...ys);
    const minY = Math.min(...ys);
    expect(maxY).toBeGreaterThan(minY);
    const highReds = reds.filter((_, idx) => (ys[idx] ?? 0) === maxY);
    const lowReds = reds.filter((_, idx) => (ys[idx] ?? 0) === minY);
    expect(highReds.length).toBe(2);
    expect(lowReds.length).toBe(2);
    for (const hi of highReds) {
      for (const lo of lowReds) {
        expect(hi).toBeGreaterThan(lo);
      }
    }
  });

  it('builds a checkerboard 1/0 cliff map without buffer truncation', () => {
    const width = 8;
    const height = 8;
    const heights = new Uint8Array(width * height);
    const surfaces = new Uint16Array(width * height);
    const ramps = new Uint8Array(width * height);
    let expectedQuads = width * height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((x + y) % 2 === 0) {
          heights[y * width + x] = 1;
        }
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((heights[y * width + x] ?? 0) === 1) {
          if (x > 0) expectedQuads += 1;
          if (x + 1 < width) expectedQuads += 1;
          if (y > 0) expectedQuads += 1;
          if (y + 1 < height) expectedQuads += 1;
        }
      }
    }
    // Exceeds the old 2 * width * height cap.
    expect(expectedQuads).toBeGreaterThan(width * height * 2);

    const geo = buildTerrainGeometry(width, height, heights, surfaces, ramps, [
      { r: 0.5, g: 0.5, b: 0.5 },
    ]);
    expect(geo.indices.length).toBe(expectedQuads * 6);
    expect(geo.positions.length).toBe(expectedQuads * 4 * 3);
    expect(geo.colors.length).toBe(expectedQuads * 4 * 3);
  });

  it('buildTerrainSkirtGeometry wraps all four borders with outward normals aligned to border elevation', () => {
    const width = 4;
    const height = 3;
    const heights = new Uint8Array(width * height);
    const ramps = new Uint8Array(width * height);
    heights[0] = 2; // NW corner cell (height 2 -> y = 1.0)
    const skirt = buildTerrainSkirtGeometry(width, height, heights, ramps);
    const expectedQuads = width * 2 + height * 2;
    expect(skirt.indices.length).toBe(expectedQuads * 6);

    const dirs = new Map<string, number>();
    let maxY = -Infinity;
    let minY = Infinity;
    for (let v = 0; v < skirt.positions.length / 3; v++) {
      const y = skirt.positions[v * 3 + 1] ?? 0;
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    expect(maxY).toBeCloseTo(1.0, 6);
    expect(minY).toBeLessThan(0);

    for (let t = 0; t < skirt.indices.length / 3; t++) {
      const n = triNormal(skirt.positions, skirt.indices, t);
      expect(n.y).toBeCloseTo(0, 6);
      const key = `${Math.round(n.x)},${Math.round(n.z)}`;
      dirs.set(key, (dirs.get(key) ?? 0) + 1);
    }
    expect(dirs.get('0,-1')).toBe(width * 2);
    expect(dirs.get('0,1')).toBe(width * 2);
    expect(dirs.get('-1,0')).toBe(height * 2);
    expect(dirs.get('1,0')).toBe(height * 2);
  });
});
