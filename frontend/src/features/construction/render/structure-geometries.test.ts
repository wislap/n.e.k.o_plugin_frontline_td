import { describe, expect, it } from 'vitest';
import { STRUCTURE_SILHOUETTES } from '../content';
import {
  buildSilhouetteGeometryData,
  createSilhouetteGeometries,
  disposeSilhouetteGeometries,
} from './structure-geometries';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function readVec(buf: Float32Array, index: number): Vec3 {
  const base = index * 3;
  return {
    x: buf[base] ?? 0,
    y: buf[base + 1] ?? 0,
    z: buf[base + 2] ?? 0,
  };
}

describe('structure-geometries', () => {
  it('builds valid outward-wound unit-box geometries for all 11 silhouettes', () => {
    const signatures = new Set<string>();

    for (const silhouette of STRUCTURE_SILHOUETTES) {
      const data = buildSilhouetteGeometryData(silhouette);
      const vertCount = data.positions.length / 3;

      expect(vertCount, `${silhouette} non-empty vertices`).toBeGreaterThan(0);
      expect(data.positions.length % 3).toBe(0);
      expect(data.normals.length).toBe(data.positions.length);
      expect(data.colors.length).toBe(data.positions.length);
      expect(data.indices.length, `${silhouette} non-empty indices`).toBeGreaterThan(0);
      expect(data.indices.length % 3).toBe(0);

      let minY = Infinity;
      let maxY = -Infinity;
      let sumAbs = 0;

      for (let v = 0; v < vertCount; v++) {
        const p = readVec(data.positions, v);
        const n = readVec(data.normals, v);
        const c = readVec(data.colors, v);

        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);
        expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)).toBe(true);

        expect(p.x, `${silhouette} x`).toBeGreaterThanOrEqual(-0.55);
        expect(p.x, `${silhouette} x`).toBeLessThanOrEqual(0.55);
        expect(p.z, `${silhouette} z`).toBeGreaterThanOrEqual(-0.55);
        expect(p.z, `${silhouette} z`).toBeLessThanOrEqual(0.55);
        expect(p.y, `${silhouette} y`).toBeGreaterThanOrEqual(-1e-4);
        expect(p.y, `${silhouette} y`).toBeLessThanOrEqual(1.05);

        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        sumAbs += Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z);

        const nLen = Math.hypot(n.x, n.y, n.z);
        expect(Math.abs(nLen - 1), `${silhouette} unit normal`).toBeLessThan(1e-4);

        expect(c.x).toBeGreaterThanOrEqual(0.55);
        expect(c.x).toBeLessThanOrEqual(1.2);
      }

      expect(minY, `${silhouette} base anchored at y = 0`).toBeLessThanOrEqual(1e-4);
      expect(maxY, `${silhouette} positive height`).toBeGreaterThan(0.5);

      const triCount = data.indices.length / 3;
      for (let t = 0; t < triCount; t++) {
        const ia = data.indices[t * 3] ?? 0;
        const ib = data.indices[t * 3 + 1] ?? 0;
        const ic = data.indices[t * 3 + 2] ?? 0;
        expect(ia).toBeLessThan(vertCount);
        expect(ib).toBeLessThan(vertCount);
        expect(ic).toBeLessThan(vertCount);

        const pa = readVec(data.positions, ia);
        const pb = readVec(data.positions, ib);
        const pc = readVec(data.positions, ic);
        const e1 = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
        const e2 = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z };
        const gn = {
          x: e1.y * e2.z - e1.z * e2.y,
          y: e1.z * e2.x - e1.x * e2.z,
          z: e1.x * e2.y - e1.y * e2.x,
        };
        const gLen = Math.hypot(gn.x, gn.y, gn.z);
        expect(gLen, `${silhouette} non-degenerate tri ${t}`).toBeGreaterThan(1e-8);

        const na = readVec(data.normals, ia);
        const dot = gn.x * na.x + gn.y * na.y + gn.z * na.z;
        expect(dot, `${silhouette} outward CCW winding tri ${t}`).toBeGreaterThan(0);
      }

      signatures.add(`${vertCount}:${data.indices.length}:${sumAbs.toFixed(3)}`);
    }

    expect(signatures.size).toBe(STRUCTURE_SILHOUETTES.length);
  });

  it('creates and disposes BufferGeometry records for every silhouette', () => {
    const geos = createSilhouetteGeometries();
    for (const silhouette of STRUCTURE_SILHOUETTES) {
      const geo = geos[silhouette];
      expect(geo.getAttribute('position')).toBeDefined();
      expect(geo.getAttribute('normal')).toBeDefined();
      expect(geo.getAttribute('color')).toBeDefined();
      expect(geo.getIndex()).not.toBeNull();
    }
    expect(() => {
      disposeSilhouetteGeometries(geos);
    }).not.toThrow();
  });
});
