export const MILLI = 1000;
export const BASIS_POINTS_ONE = 10000;

export function assertSafeInteger(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`expected a safe integer, got ${n}`);
  }
}

// True floor division (rounds toward -Infinity, unlike Math.trunc division).
export function floorDiv(a: number, b: number): number {
  if (import.meta.env.DEV) {
    assertSafeInteger(a);
    assertSafeInteger(b);
    if (b === 0) {
      throw new RangeError('floorDiv: divisor must not be zero');
    }
  }
  return Math.floor(a / b);
}

// floor(a * b / c); the intermediate product must stay a safe integer.
export function mulDiv(a: number, b: number, c: number): number {
  const product = a * b;
  if (import.meta.env.DEV) {
    assertSafeInteger(a);
    assertSafeInteger(b);
    assertSafeInteger(c);
    assertSafeInteger(product);
    if (c === 0) {
      throw new RangeError('mulDiv: divisor must not be zero');
    }
  }
  return Math.floor(product / c);
}

export function applyBasisPoints(quantity: number, basisPoints: number): number {
  return mulDiv(quantity, basisPoints, BASIS_POINTS_ONE);
}
