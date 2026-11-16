import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/index';
import { interpAlpha, lerp } from './interpolate';

describe('interpAlpha', () => {
  it('clamps to [0, 1]', () => {
    expect(interpAlpha(0, 100, 50)).toBe(0);
    expect(interpAlpha(200, 100, 50)).toBe(1);
    expect(interpAlpha(125, 100, 50)).toBeCloseTo(0.5, 6);
  });

  it('falls back to TICK_MS when no interval has been measured', () => {
    expect(interpAlpha(100 + TICK_MS / 2, 100, 0)).toBeCloseTo(0.5, 6);
    expect(interpAlpha(110, 100, -5, 20)).toBeCloseTo(0.5, 6);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(2, 6, 0.25)).toBeCloseTo(3, 6);
  });
});
