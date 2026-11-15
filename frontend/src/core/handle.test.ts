import { describe, expect, it } from 'vitest';
import { handleGeneration, handleId, MAX_GENERATION, NULL_HANDLE, packHandle } from './handle';

describe('handle', () => {
  it('round-trips id and generation', () => {
    const h = packHandle(1, 0);
    expect(handleId(h)).toBe(1);
    expect(handleGeneration(h)).toBe(0);
    const big = packHandle(4294967295, MAX_GENERATION);
    expect(handleId(big)).toBe(4294967295);
    expect(handleGeneration(big)).toBe(MAX_GENERATION);
  });

  it('distinguishes generations for the same id', () => {
    expect(packHandle(5, 1)).not.toBe(packHandle(5, 2));
  });

  it('rejects out-of-range inputs', () => {
    expect(() => packHandle(0, 0)).toThrow(RangeError);
    expect(() => packHandle(4294967296, 0)).toThrow(RangeError);
    expect(() => packHandle(1, MAX_GENERATION + 1)).toThrow(RangeError);
  });

  it('NULL_HANDLE decodes to id 0 which is never a live id', () => {
    expect(handleId(NULL_HANDLE)).toBe(0);
    expect(handleGeneration(NULL_HANDLE)).toBe(0);
  });
});
