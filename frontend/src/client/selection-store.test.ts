import { describe, expect, it } from 'vitest';
import { pruneSelected } from './selection-store';

describe('pruneSelected', () => {
  it('drops handles absent from the latest snapshot', () => {
    const selected = new Set([1, 2, 3, 4]);
    const valid = new Set([2, 4, 9]);
    expect([...pruneSelected(selected, valid)].sort()).toEqual([2, 4]);
  });

  it('keeps everything when all handles are still valid', () => {
    const selected = new Set([1, 2]);
    expect([...pruneSelected(selected, new Set([1, 2, 3]))].sort()).toEqual([1, 2]);
  });
});
