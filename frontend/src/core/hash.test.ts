import { describe, expect, it } from 'vitest';
import { hashCanonical } from './hash';

describe('hashCanonical', () => {
  it('is independent of object key order', () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it('distinguishes typed array types with the same elements', () => {
    expect(hashCanonical(new Uint8Array([1, 2]))).not.toBe(hashCanonical(new Uint16Array([1, 2])));
  });

  it('hashes nested structures deterministically', () => {
    const value = { z: [1, 'a', null, true], m: { k: new Float64Array([1.5]) } };
    expect(hashCanonical(value)).toBe(hashCanonical(value));
    expect(hashCanonical(value)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects functions, class instances, Maps and undefined in arrays', () => {
    expect(() => hashCanonical({ f: () => 1 })).toThrow(TypeError);
    class Box {
      x = 1;
    }
    expect(() => hashCanonical(new Box())).toThrow(TypeError);
    expect(() => hashCanonical(new Map())).toThrow(TypeError);
    expect(() => hashCanonical([undefined])).toThrow(TypeError);
  });
});
