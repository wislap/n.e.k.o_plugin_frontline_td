import { describe, expect, it } from 'vitest';
import { buildTerrainGeometry } from './geometry';

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
