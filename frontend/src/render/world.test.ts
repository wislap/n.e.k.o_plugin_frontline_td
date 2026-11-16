import { describe, expect, it } from 'vitest';
import { HEIGHT_STEP, cellToScene, heightLevelAt, terrainY } from './world';

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
});
