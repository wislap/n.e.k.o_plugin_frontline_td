import { describe, expect, it } from 'vitest';
import { createRngState, rngNextIntBelow, rngNextUint32 } from './rng';

describe('rng', () => {
  it('produces golden first outputs for a fixed seed+stream', () => {
    const state = createRngState(1234, 'frontline_td:test.golden');
    const outputs = Array.from({ length: 4 }, () => rngNextUint32(state));
    // Update these literals only when the stream derivation intentionally changes.
    expect(outputs).toEqual([2862911573, 3947436055, 4235037180, 3703851885]);
  });

  it('distinct streams differ', () => {
    const a = createRngState(1, 'pack:a');
    const b = createRngState(1, 'pack:b');
    expect(rngNextUint32(a)).not.toBe(rngNextUint32(b));
  });

  it('same seed+stream reproduces the sequence', () => {
    const a = createRngState(7, 'pack:s');
    const b = createRngState(7, 'pack:s');
    for (let i = 0; i < 10; i++) {
      expect(rngNextUint32(a)).toBe(rngNextUint32(b));
    }
  });

  it('rngNextIntBelow stays in range and varies', () => {
    const state = createRngState(9, 'pack:n');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const v = rngNextIntBelow(state, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it('rngNextIntBelow rejects bad n', () => {
    const state = createRngState(1, 'pack:x');
    expect(() => rngNextIntBelow(state, 0)).toThrow(RangeError);
    expect(() => rngNextIntBelow(state, 1.5)).toThrow(RangeError);
  });
});
