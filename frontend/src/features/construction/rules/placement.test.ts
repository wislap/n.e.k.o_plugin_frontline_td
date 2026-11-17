// Table-driven tests for the shared placement rules: every code is
// produced by a stub view, so the sim and client adapters stay honest.
import { describe, expect, it } from 'vitest';
import { checkFootprint, checkRange } from './placement';
import type { PlacementRule, PlacementView } from './placement';

const RULE_2x2_NODE: PlacementRule = {
  w: 2,
  h: 2,
  node: true,
  connect: 200,
  requiresDeposit: -1,
};
const RULE_2x2: PlacementRule = { ...RULE_2x2_NODE, node: false };

function view(overrides: Partial<PlacementView> = {}): PlacementView {
  return {
    width: 10,
    height: 10,
    passable: () => true,
    heightAt: () => 0,
    isRamp: () => false,
    blocked: () => false,
    reservedByOwn: () => false,
    covered: () => true,
    depositAt: () => -1,
    connects: () => true,
    ...overrides,
  };
}

describe('checkFootprint', () => {
  const cases: { name: string; v: Partial<PlacementView>; x?: number; y?: number; want: string }[] =
    [
      { name: 'ok on flat open ground', v: {}, want: 'ok' },
      { name: 'out of bounds (edge)', v: {}, x: 9, want: 'out_of_bounds' },
      { name: 'impassable static terrain', v: { passable: (x) => x !== 4 }, x: 3, want: 'terrain' },
      { name: 'ramp cell rejected', v: { isRamp: (x) => x === 4 }, x: 4, want: 'terrain' },
      {
        name: 'uneven heights',
        v: { heightAt: (x) => (x === 4 ? 1 : 0) },
        x: 3,
        want: 'uneven',
      },
      { name: 'blocked cell occupied', v: { blocked: (x) => x === 4 }, x: 4, want: 'occupied' },
      {
        name: 'own blueprint reservation',
        v: { reservedByOwn: () => true },
        want: 'reserved',
      },
    ];
  for (const c of cases) {
    it(c.name, () => {
      expect(checkFootprint(RULE_2x2, c.x ?? 2, c.y ?? 2, view(c.v))).toBe(c.want);
    });
  }

  it('requiresDeposit needs one matching footprint cell', () => {
    const rule: PlacementRule = { ...RULE_2x2, requiresDeposit: 3 };
    expect(checkFootprint(rule, 2, 2, view({ depositAt: () => -1 }))).toBe('needs_deposit');
    expect(
      checkFootprint(rule, 2, 2, view({ depositAt: (x, y) => (x === 2 && y === 3 ? 3 : -1) })),
    ).toBe('ok');
  });

  it('reason precedence: bounds before terrain, terrain before occupied', () => {
    const v = view({ passable: () => false, blocked: () => true });
    expect(checkFootprint(RULE_2x2, 9, 2, v)).toBe('out_of_bounds');
    expect(checkFootprint(RULE_2x2, 2, 2, v)).toBe('terrain');
    const v2 = view({ blocked: () => true, reservedByOwn: () => true });
    expect(checkFootprint(RULE_2x2, 2, 2, v2)).toBe('occupied');
  });
});

describe('checkRange', () => {
  it('node structures must connect', () => {
    expect(checkRange(RULE_2x2_NODE, 2, 2, view({ connects: () => false }))).toBe('not_connected');
    expect(checkRange(RULE_2x2_NODE, 2, 2, view())).toBe('ok');
  });

  it('non-node structures need coverage at the centre cell', () => {
    const cells: string[] = [];
    const v = view({
      covered: (x, y) => {
        cells.push(`${x},${y}`);
        return false;
      },
    });
    expect(checkRange(RULE_2x2, 2, 2, v)).toBe('not_covered');
    // Centre cell of a 2x2 at (2,2) is (3,3).
    expect(cells).toEqual(['3,3']);
    expect(checkRange(RULE_2x2, 2, 2, view())).toBe('ok');
  });
});
