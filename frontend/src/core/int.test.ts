import { describe, expect, it } from 'vitest';
import {
  applyBasisPoints,
  assertSafeInteger,
  BASIS_POINTS_ONE,
  floorDiv,
  MILLI,
  mulDiv,
} from './int';

describe('int', () => {
  it('exports the quantity constants', () => {
    expect(MILLI).toBe(1000);
    expect(BASIS_POINTS_ONE).toBe(10000);
  });

  it('floorDiv rounds toward -Infinity including negatives', () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(7, -2)).toBe(-4);
    expect(floorDiv(-7, -2)).toBe(3);
    expect(floorDiv(0, 5)).toBe(0);
  });

  it('floorDiv rejects a zero divisor', () => {
    expect(() => floorDiv(1, 0)).toThrow(RangeError);
  });

  it('mulDiv computes floor(a*b/c)', () => {
    expect(mulDiv(10, 3, 4)).toBe(7);
    expect(mulDiv(-10, 3, 4)).toBe(-8);
    expect(mulDiv(1000, 1500, 10000)).toBe(150);
  });

  it('assertSafeInteger throws on unsafe values', () => {
    expect(() => {
      assertSafeInteger(1.5);
    }).toThrow(RangeError);
    expect(() => {
      assertSafeInteger(Number.MAX_SAFE_INTEGER + 1);
    }).toThrow(RangeError);
    expect(() => {
      assertSafeInteger(Number.MAX_SAFE_INTEGER);
    }).not.toThrow();
  });

  it('mulDiv asserts the intermediate product is safe', () => {
    expect(() => mulDiv(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow(RangeError);
  });

  it('applyBasisPoints is mulDiv by 10000', () => {
    expect(applyBasisPoints(123456, 2500)).toBe(30864);
  });
});
