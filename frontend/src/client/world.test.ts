import { describe, expect, it } from 'vitest';
import {
  HEIGHT_STEP,
  buildCameraElevationField,
  cellToScene,
  getCameraElevationField,
  heightLevelAt,
  sampleCameraElevation,
  terrainY,
} from './world';

describe('world mapping', () => {
  it('maps cell (x, y) to scene (x, height*step, z=y)', () => {
    const p = cellToScene(3, 7, 2);
    expect(p).toEqual({ x: 3, y: 2 * HEIGHT_STEP, z: 7 });
  });

  it('map y grows towards +z (north = -z is screen-up)', () => {
    const north = cellToScene(0, 0, 0);
    const south = cellToScene(0, 10, 0);
    expect(north.z).toBeLessThan(south.z);
  });

  it('heightLevelAt returns null outside the grid', () => {
    const heights = new Uint8Array(4).fill(1);
    expect(heightLevelAt(heights, 2, 2, 1, 1)).toBe(1);
    expect(heightLevelAt(heights, 2, 2, -1, 0)).toBeNull();
    expect(heightLevelAt(heights, 2, 2, 2, 0)).toBeNull();
    expect(heightLevelAt(heights, 2, 2, 0, 2)).toBeNull();
  });

  it('terrainY uses the floored cell', () => {
    const heights = new Uint8Array([0, 0, 0, 2]);
    expect(terrainY(heights, 2, 2, 1.7, 1.2)).toBe(2 * HEIGHT_STEP);
  });

  it('caches smooth elevation field, computes map mean baseY, and blends cliff steps continuously', () => {
    const width = 32;
    const height = 16;
    const heights = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        heights[y * width + x] = x >= 16 ? 4 : 0;
      }
    }

    const fieldA = getCameraElevationField(heights, width, height);
    const fieldB = getCameraElevationField(heights, width, height);
    expect(fieldB).toBe(fieldA);
    expect(fieldA.baseY).toBeCloseTo(2 * HEIGHT_STEP, 6);

    const custom = buildCameraElevationField(heights, width, height, 6);
    expect(custom.baseY).toBeCloseTo(2 * HEIGHT_STEP, 6);

    const sBefore = sampleCameraElevation(fieldA, 15.9, 8.5);
    const sEdge = sampleCameraElevation(fieldA, 16.0, 8.5);
    const sAfter = sampleCameraElevation(fieldA, 16.1, 8.5);
    expect(sBefore).toBeLessThan(sEdge);
    expect(sEdge).toBeLessThan(sAfter);
    // Crossing a cliff edge shifts sampled height by a tiny continuous fraction, never 2.0 units.
    expect(sAfter - sBefore).toBeLessThan(0.05);
  });
});
