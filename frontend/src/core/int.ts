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

const LN2_MICRO = 693147; // round(ln(2) * 1e6)

// round(1000 * ln(valueMilli / 1000)) for valueMilli >= 1000, integer-only
// (no Math.log — ADR 0006): the mantissa is range-reduced to [1, 2) in
// micro units by repeated halving, then ln(y) = 2·atanh((y−1)/(y+1))
// is summed as a fixed-point series. Error is a few micro — always well
// inside the ±1 milli rounding bound.
export function lnMilli(valueMilli: number): number {
  if (import.meta.env.DEV) {
    assertSafeInteger(valueMilli);
    if (valueMilli < MILLI) {
      throw new RangeError(`lnMilli expects valueMilli >= ${MILLI}, got ${valueMilli}`);
    }
  }
  let mantissa = valueMilli * MILLI; // micro units
  let halvings = 0;
  while (mantissa >= 2_000_000) {
    mantissa = Math.floor(mantissa / 2);
    halvings += 1;
  }
  // z = (y - 1) / (y + 1) ∈ [0, 1/3) in micro units.
  const z = Math.floor(((mantissa - 1_000_000) * 1_000_000) / (mantissa + 1_000_000));
  const z2 = Math.floor((z * z) / 1_000_000);
  let term = z;
  let sum = 0;
  for (let i = 1; term > 0; i += 2) {
    sum += Math.floor(term / i);
    term = Math.floor((term * z2) / 1_000_000);
  }
  const lnMicro = 2 * sum + halvings * LN2_MICRO;
  return Math.floor((lnMicro + 500) / MILLI);
}
