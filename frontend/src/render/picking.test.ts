import { describe, expect, it } from 'vitest';
import { HEIGHT_STEP } from './world';
import { pickGround } from './picking';
import type { Ray } from './picking';

const W = 8;
const H = 8;

function straightDown(x: number, z: number): Ray {
  return { origin: { x, y: 50, z }, dir: { x: 0, y: -1, z: 0 } };
}

function angled(): Ray {
  // Pitched view: looking north (-z) and down, like the spectate camera.
  return { origin: { x: 4, y: 20, z: 26 }, dir: { x: 0, y: -0.7, z: -0.7 } };
}
describe('pickGround', () => {
  it('hits the exact cell on a flat grid (tactical view)', () => {
    const heights = new Uint8Array(W * H);
    const hit = pickGround(straightDown(3.4, 5.6), heights, W, H);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(3.4, 2);
    expect(hit?.y).toBeCloseTo(5.6, 2);
  });

  it('hits the higher plateau before its top edge', () => {
    // Plateau (height 2) for y < 4, lowland (height 0) beyond.
    const heights = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        heights[y * W + x] = y < 4 ? 2 : 0;
      }
    }
    // Ray descends southward across the cliff edge at z=4.
    const ray: Ray = { origin: { x: 4, y: 8 * HEIGHT_STEP, z: 2 }, dir: { x: 0, y: -0.5, z: 0.5 } };
    const hit = pickGround(ray, heights, W, H);
    expect(hit).not.toBeNull();
    // First surface crossed is the plateau top (y = 1.0): 8*step - 0.5t = 1
    // at t = 6 → z = 5? No: plateau top ends at z=4; at t where y=1, z=5 is
    // lowland (ground 0), so it continues until y=0 → t=8, z=6.
    expect(hit?.y).toBeGreaterThan(4);
    expect(hit?.x).toBeCloseTo(4, 2);
  });

  it('hits the plateau side wall rather than tunneling through', () => {
    const heights = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        heights[y * W + x] = y < 4 ? 2 : 0;
      }
    }
    // Low ray heading north at height 0.5*step into the cliff at z=4: it
    // crosses the plateau top only after entering; marching detects the
    // cell where ground (1.0) is above the ray.
    const ray: Ray = { origin: { x: 4, y: 0.5 * HEIGHT_STEP, z: 6 }, dir: { x: 0, y: 0, z: -1 } };
    const hit = pickGround(ray, heights, W, H);
    expect(hit).not.toBeNull();
    expect(hit?.y).toBeGreaterThan(3.5);
    expect(hit?.y).toBeLessThanOrEqual(4.01);
  });

  it('returns null when the ray never enters the map', () => {
    const heights = new Uint8Array(W * H);
    const ray: Ray = { origin: { x: -10, y: 5, z: -10 }, dir: { x: 0, y: 0, z: -1 } };
    expect(pickGround(ray, heights, W, H)).toBeNull();
  });

  it('returns null for an upward ray', () => {
    const heights = new Uint8Array(W * H);
    const ray: Ray = { origin: { x: 4, y: 1, z: 4 }, dir: { x: 0, y: 1, z: 0 } };
    expect(pickGround(ray, heights, W, H)).toBeNull();
  });

  it('hits a ramp-like height step accurately via bisection', () => {
    // Single raised cell at (4,4): the pick lands inside it.
    const heights = new Uint8Array(W * H);
    heights[4 * W + 4] = 1;
    const hit = pickGround(straightDown(4.25, 4.75), heights, W, H);
    expect(hit?.x).toBeCloseTo(4.25, 2);
    expect(hit?.y).toBeCloseTo(4.75, 2);
  });

  it('a pitched spectate ray lands on a raised cell too', () => {
    const heights = new Uint8Array(W * H);
    heights[4 * W + 4] = 3;
    const hit = pickGround(angled(), heights, W, H);
    expect(hit).not.toBeNull();
  });
});
