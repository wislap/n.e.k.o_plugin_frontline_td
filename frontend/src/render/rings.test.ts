// Ring/arc strip geometry (M5 batch D): closed-loop segments for
// exclusion circles and partial arcs for capture progress.
import { describe, expect, it } from 'vitest';
import { arcStrip, ringStrip } from './rings';

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
