import { describe, expect, it } from 'vitest';
import {
  applyBasisPoints,
  assertSafeInteger,
  BASIS_POINTS_ONE,
  floorDiv,
  lnMilli,
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

  // Hard-coded reference: expected[n - 1] = round(1000 * ln(n + e)),
  // generated once offline (Math.log is banned in the purity zone).
  const LN_TABLE = [
    1313, 1551, 1744, 1905, 2044, 2165, 2274, 2372, 2461, 2543, 2619, 2689, 2755, 2816, 2875, 2929,
    2982, 3031, 3078, 3123, 3166, 3208, 3247, 3285, 3322, 3358, 3392, 3425, 3457, 3488, 3518, 3547,
    3576, 3603, 3630, 3656, 3682, 3707, 3731, 3755, 3778, 3800, 3822, 3844, 3865, 3886, 3906, 3926,
    3946, 3965, 3984, 4002, 4020, 4038, 4056, 4073, 4090, 4106, 4123, 4139, 4154, 4170, 4185, 4200,
    4215, 4230, 4244, 4259, 4273, 4287, 4300, 4314, 4327, 4340, 4353, 4366, 4378, 4391, 4403, 4415,
    4427, 4439, 4451, 4463, 4474, 4485, 4497, 4508, 4519, 4530, 4540, 4551, 4561, 4572, 4582, 4592,
    4602, 4612, 4622, 4632, 4642, 4651, 4661, 4670, 4680, 4689, 4698, 4707, 4716, 4725, 4734, 4742,
    4751, 4760, 4768, 4777, 4785, 4793, 4802, 4810, 4818, 4826, 4834, 4842, 4850, 4858, 4865, 4873,
    4881, 4888, 4896, 4903, 4911, 4918, 4925, 4932, 4940, 4947, 4954, 4961, 4968, 4975, 4982, 4989,
    4995, 5002, 5009, 5015, 5022, 5029, 5035, 5042, 5048, 5054, 5061, 5067, 5073, 5080, 5086, 5092,
    5098, 5104, 5110, 5116, 5122, 5128, 5134, 5140, 5146, 5152, 5157, 5163, 5169, 5175, 5180, 5186,
    5191, 5197, 5202, 5208, 5213, 5219, 5224, 5230, 5235, 5240, 5246, 5251, 5256, 5261, 5266, 5272,
    5277, 5282, 5287, 5292, 5297, 5302, 5307, 5312,
  ];

  it('lnMilli matches the hard-coded table for n + e, n = 1..200', () => {
    for (let n = 1; n <= 200; n++) {
      const expected = LN_TABLE[n - 1] ?? 0;
      expect(Math.abs(lnMilli(n * 1000 + 2718) - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('lnMilli covers the extra reference points', () => {
    expect(lnMilli(1000)).toBe(0);
    expect(Math.abs(lnMilli(2000) - 693)).toBeLessThanOrEqual(1);
    expect(Math.abs(lnMilli(1_000_000) - 6908)).toBeLessThanOrEqual(1);
  });

  it('lnMilli rejects values below 1000 in dev', () => {
    expect(() => lnMilli(999)).toThrow(RangeError);
  });
});
