import { describe, expect, it } from 'vitest';
import {
  CLEARANCE_HEAVY,
  CLEARANCE_STANDARD,
  CLEARANCE_TIERS,
  STANDARD_RADIUS_MAX,
  type ClearanceTier,
  clearanceAnchorCell,
  clearanceAnchorCenter,
  clearanceFootprintSize,
  clearanceTierForRadius,
} from './index';

describe('clearance rules', () => {
  it('defines expected clearance tier constants', () => {
    expect(CLEARANCE_STANDARD).toBe(0);
    expect(CLEARANCE_HEAVY).toBe(1);
    expect(CLEARANCE_TIERS).toBe(2);
    expect(STANDARD_RADIUS_MAX).toBe(0.45);
  });

  it('classifies unit radius into standard vs heavy tiers at boundary 0.45', () => {
    const standardSmall: ClearanceTier = clearanceTierForRadius(0.35);
    const standardMax: ClearanceTier = clearanceTierForRadius(0.45);
    const heavyJustAbove: ClearanceTier = clearanceTierForRadius(0.4501);
    const heavyLarge: ClearanceTier = clearanceTierForRadius(0.85);

    expect(standardSmall).toBe(CLEARANCE_STANDARD);
    expect(standardMax).toBe(CLEARANCE_STANDARD);
    expect(heavyJustAbove).toBe(CLEARANCE_HEAVY);
    expect(heavyLarge).toBe(CLEARANCE_HEAVY);
  });

  it('returns footprint sizes 1 and 2 for standard and heavy tiers', () => {
    expect(clearanceFootprintSize(CLEARANCE_STANDARD)).toBe(1);
    expect(clearanceFootprintSize(CLEARANCE_HEAVY)).toBe(2);
  });

  it('maps world <-> anchor <-> center in a 2-cell corridor [4.0, 6.0]', () => {
    // Standard 1x1 units occupy single cells [4, 5) and [5, 6) centered at 4.5 and 5.5.
    expect(clearanceAnchorCell(4.0, CLEARANCE_STANDARD)).toBe(4);
    expect(clearanceAnchorCell(4.5, CLEARANCE_STANDARD)).toBe(4);
    expect(clearanceAnchorCell(4.99, CLEARANCE_STANDARD)).toBe(4);
    expect(clearanceAnchorCell(5.5, CLEARANCE_STANDARD)).toBe(5);
    expect(clearanceAnchorCenter(4, CLEARANCE_STANDARD)).toBe(4.5);
    expect(clearanceAnchorCenter(5, CLEARANCE_STANDARD)).toBe(5.5);

    // Heavy 2x2 units spanning [4.0, 6.0] share top-left anchor 4 centered at 5.0.
    expect(clearanceAnchorCell(4.5, CLEARANCE_HEAVY)).toBe(4);
    expect(clearanceAnchorCell(5.0, CLEARANCE_HEAVY)).toBe(4);
    expect(clearanceAnchorCell(5.49, CLEARANCE_HEAVY)).toBe(4);
    expect(clearanceAnchorCell(5.5, CLEARANCE_HEAVY)).toBe(5);
    expect(clearanceAnchorCenter(4, CLEARANCE_HEAVY)).toBe(5.0);

    // Round-trip anchor -> center -> anchor for both tiers.
    expect(
      clearanceAnchorCell(clearanceAnchorCenter(4, CLEARANCE_STANDARD), CLEARANCE_STANDARD),
    ).toBe(4);
    expect(clearanceAnchorCell(clearanceAnchorCenter(4, CLEARANCE_HEAVY), CLEARANCE_HEAVY)).toBe(4);
  });
});
