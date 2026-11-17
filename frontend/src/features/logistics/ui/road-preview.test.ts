import { describe, expect, test } from 'vitest';
import { estimateMultiplierBp, roadPreview, type RoadPreviewLink } from './road-preview';

const MULT = [10000, 20000];

describe('estimateMultiplierBp', () => {
  test('harmonic mean over cell levels', () => {
    // Half dirt, half paved: 2 / (1/10000 + 1/20000) = 13333.3.
    expect(estimateMultiplierBp([0, 1], MULT)).toBeCloseTo(13333.3, 0);
  });

  test('uniform level returns that level multiplier', () => {
    expect(estimateMultiplierBp([1, 1, 1], MULT)).toBeCloseTo(20000, 5);
  });
});

describe('roadPreview', () => {
  const link: RoadPreviewLink = {
    m: 13333,
    quotaOut: 1000,
    quotaIn: 500,
    volOut: 300,
    volIn: 100,
    cells: [0, 1, 2],
  };

  test('counts cells below target and scales quota by m ratio', () => {
    // Cells 0,1 paved? roadLevel: cell0=1, cell1=0, cell2=0 -> 2 to pave.
    // Levels treated as [1,1,1] -> newM 20000; scale = 20000/13333.
    const p = roadPreview([link], new Set([0]), (c) => (c === 0 ? 1 : 0), 1, MULT);
    expect(p.cellsToPave).toBe(2);
    expect(p.quotaOut).toBe(1000);
    expect(p.quotaOutNew).toBe(Math.round((1000 * 20000) / 13333));
    expect(p.quotaInNew).toBe(Math.round((500 * 20000) / 13333));
    expect(p.volOut).toBe(300);
    expect(p.volIn).toBe(100);
  });

  test('ignores unselected links', () => {
    const p = roadPreview([link], new Set(), () => 0, 1, MULT);
    expect(p.cellsToPave).toBe(0);
    expect(p.quotaOutNew).toBe(0);
  });
});
