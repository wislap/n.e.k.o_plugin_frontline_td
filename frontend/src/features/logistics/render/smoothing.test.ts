// Overlay flow smoothing (M3 D): exponential moving average over ~30 s.
import { describe, expect, it } from 'vitest';
import { emaUpdate } from './smoothing';

describe('emaUpdate', () => {
  it('holds the previous value when no time passed', () => {
    expect(emaUpdate(0.4, 1, 0)).toBe(0.4);
    expect(emaUpdate(0.4, 1, -10)).toBe(0.4);
  });

  it('moves toward the new value and converges over the window', () => {
    let v = 0;
    v = emaUpdate(v, 1, 1000);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    for (let i = 0; i < 200; i++) {
      v = emaUpdate(v, 1, 1000);
    }
    expect(v).toBeCloseTo(1, 2);
  });

  it('is frame-rate independent for the same elapsed time', () => {
    const one = emaUpdate(emaUpdate(0, 1, 500), 1, 500);
    const two = emaUpdate(0, 1, 1000);
    expect(one).toBeCloseTo(two, 10);
  });
});
