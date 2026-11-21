// Ring/arc strip geometry (M5 batch D): closed-loop segments for
// exclusion circles and partial arcs for capture progress.
import { describe, expect, it } from 'vitest';
import { arcStrip, ringStrip, writeArcVertices, writeRingVertices } from './rings';

describe('ringStrip', () => {
  it('emits one closed loop segment per slice', () => {
    const pts = ringStrip(5, 5, 1, 3, 8);
    expect(pts.length).toBe(8 * 6);
    // First segment starts on +x, last ends where the first started.
    expect(pts[0]).toBeCloseTo(8);
    expect(pts[2]).toBeCloseTo(5);
    expect(pts[pts.length - 3]).toBeCloseTo(8);
    expect(pts[pts.length - 1]).toBeCloseTo(5);
  });
});

describe('arcStrip', () => {
  it('covers only the requested fraction, at double width', () => {
    const half = arcStrip(0, 0, 0, 2, 0.5, 8);
    const full = arcStrip(0, 0, 0, 2, 1, 8);
    expect(full.length).toBe(8 * 2 * 6);
    expect(half.length).toBe(4 * 2 * 6);
    expect(arcStrip(0, 0, 0, 2, 0, 8).length).toBe(2 * 6); // clamped to >=1
  });
});

describe('writeRingVertices', () => {
  it('matches ringStrip output for solid rings and writes colors', () => {
    const expected = ringStrip(5, 5, 1, 3, 8);
    const positions = new Float32Array(expected.length);
    const colors = new Float32Array(expected.length);
    const cursor = writeRingVertices(positions, colors, 0, 5, 5, 1, 3, 8, 0.25, 0.5, 0.75);
    expect(cursor).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(positions[i]).toBeCloseTo(expected[i] ?? 0, 5);
    }
    for (let i = 0; i < colors.length; i += 3) {
      expect(colors[i]).toBeCloseTo(0.25, 5);
      expect(colors[i + 1]).toBeCloseTo(0.5, 5);
      expect(colors[i + 2]).toBeCloseTo(0.75, 5);
    }
  });

  it('skips odd segments when dashed is true', () => {
    const solid = ringStrip(2, -1, 0.5, 4, 8);
    const positions = new Float32Array(8 * 6);
    const cursor = writeRingVertices(positions, null, 0, 2, -1, 0.5, 4, 8, 1, 1, 1, true);
    expect(cursor).toBe(4 * 6);
    // Even segments 0, 2, 4, 6 match segments 0, 2, 4, 6 of solid ringStrip.
    for (let seg = 0; seg < 4; seg++) {
      const solidOff = seg * 2 * 6;
      const dashOff = seg * 6;
      for (let k = 0; k < 6; k++) {
        expect(positions[dashOff + k]).toBeCloseTo(solid[solidOff + k] ?? 0, 5);
      }
    }
  });

  it('clips safely without overflowing positions', () => {
    // Enough room for 2 segments (12 floats) plus 4 spare floats (< 6).
    const positions = new Float32Array(16);
    positions.fill(-99);
    const colors = new Float32Array(16);
    colors.fill(-99);
    const cursor = writeRingVertices(positions, colors, 0, 0, 0, 0, 2, 8, 0.1, 0.2, 0.3);
    expect(cursor).toBe(12);
    expect(positions[12]).toBe(-99);
    expect(colors[12]).toBe(-99);
  });
});

describe('writeArcVertices', () => {
  it('matches arcStrip output and writes colors across fractions', () => {
    for (const frac of [0, 0.5, 1]) {
      const expected = arcStrip(1, -2, 0.2, 3.5, frac, 12);
      const positions = new Float32Array(expected.length);
      const colors = new Float32Array(expected.length);
      const cursor = writeArcVertices(
        positions,
        colors,
        0,
        1,
        -2,
        0.2,
        3.5,
        frac,
        12,
        0.9,
        0.4,
        0.1,
      );
      expect(cursor).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(positions[i]).toBeCloseTo(expected[i] ?? 0, 5);
      }
      for (let i = 0; i < colors.length; i += 3) {
        expect(colors[i]).toBeCloseTo(0.9, 5);
        expect(colors[i + 1]).toBeCloseTo(0.4, 5);
        expect(colors[i + 2]).toBeCloseTo(0.1, 5);
      }
    }
  });

  it('clips safely before overflowing positions', () => {
    const positions = new Float32Array(18);
    positions.fill(-77);
    const cursor = writeArcVertices(positions, null, 0, 0, 0, 0, 2, 1, 8, 1, 1, 1);
    expect(cursor).toBe(18);
  });
});
