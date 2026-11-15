import { describe, expect, it } from 'vitest';
import { perSecondToPerTick, secondsToTicks, unitsToMilli } from './time';

describe('content time conversions', () => {
  it('rounds sub-tick seconds up to one tick', () => {
    expect(secondsToTicks(0.01)).toBe(1);
    expect(secondsToTicks(0.025)).toBe(1);
    expect(secondsToTicks(0.075)).toBe(2);
    expect(secondsToTicks(1)).toBe(20);
  });

  it('clamps zero to the one-tick minimum', () => {
    expect(secondsToTicks(0)).toBe(1);
  });

  it('throws on negative or non-finite seconds', () => {
    expect(() => secondsToTicks(-0.5)).toThrow(RangeError);
    expect(() => secondsToTicks(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => secondsToTicks(Number.NaN)).toThrow(RangeError);
  });

  it('converts units to milli with round-half-up', () => {
    expect(unitsToMilli(1)).toBe(1000);
    expect(unitsToMilli(0.0005)).toBe(1);
    expect(unitsToMilli(2.25)).toBe(2250);
    expect(() => unitsToMilli(Number.NaN)).toThrow(RangeError);
  });

  it('divides a per-second rate into per-tick milli', () => {
    expect(perSecondToPerTick(1)).toBe(50);
    expect(perSecondToPerTick(0.33)).toBe(16);
  });
});
