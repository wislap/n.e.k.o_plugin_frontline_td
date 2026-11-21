// Pure client vision helpers (M5 batch D): cell visibility against the
// observer's fog layer, the unexplored/explored bucketing the FogLayer
// instances from, and the hostile-excluder merge over structures +
// memory rows. The ring/arc strip geometry lives in render/rings and is
// covered by render/rings.test.ts.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/index';
import { STATE_OPERATIONAL, STATE_RUIN } from '../../construction/protocol';
import { hostileExcluders, isCellVisible } from './index';

const W = 10;
const H = 8;
const layer = new Uint8Array(W * H);
layer[2 * W + 3] = 2; // visible
layer[4 * W + 1] = 1; // explored
layer[5 * W + 9] = 2; // visible corner

describe('isCellVisible', () => {
  it('is true only for layer value 2', () => {
    expect(isCellVisible(layer, W, 3.5, 2.9)).toBe(true);
    expect(isCellVisible(layer, W, 9.1, 5.0)).toBe(true);
    expect(isCellVisible(layer, W, 1.5, 4.5)).toBe(false); // explored
    expect(isCellVisible(layer, W, 0.5, 0.5)).toBe(false); // unseen
  });

  it('rejects out-of-bounds and missing layers', () => {
    expect(isCellVisible(layer, W, -1, 2)).toBe(false);
    expect(isCellVisible(layer, W, W + 1, 2)).toBe(false);
    expect(isCellVisible(undefined, W, 3, 2)).toBe(false);
  });
});

describe('beam fog filtering', () => {
  // BeamsLayer drops a shot when BOTH endpoint cells are hidden.
  it('keeps a beam when either endpoint is visible', () => {
    const beam = (x0: number, y0: number, x1: number, y1: number): boolean =>
      isCellVisible(layer, W, x0, y0) || isCellVisible(layer, W, x1, y1);
    expect(beam(0, 0, 3, 2)).toBe(true); // target visible
    expect(beam(9, 5, 0, 0)).toBe(true); // source visible
    expect(beam(0, 0, 1, 4)).toBe(false); // both hidden
  });
});

describe('hostileExcluders', () => {
  const db = loadContent();
  const OUTPOST = db.structures.byId('frontline_td:outpost');
  const DEPOT = db.structures.byId('frontline_td:supply_depot');
  if (OUTPOST === undefined || DEPOT === undefined) {
    throw new Error('structures missing');
  }
  const rows = (over: {
    kind: number[];
    x: number[];
    y: number[];
    faction: number[];
    state: number[];
  }) => ({
    handles: Float64Array.from({ length: over.kind.length }, (_, i) => i + 1),
    kind: Uint16Array.from(over.kind),
    x: Uint16Array.from(over.x),
    y: Uint16Array.from(over.y),
    faction: Uint16Array.from(over.faction),
    state: Uint8Array.from(over.state),
  });
  const hostile = (f: number): boolean => f === 2;

  it('lists operational hostile structures with exclusion', () => {
    const live = rows({
      kind: [OUTPOST.index, OUTPOST.index, DEPOT.index],
      x: [20, 40, 60],
      y: [40, 40, 40],
      faction: [2, 1, 2], // hostile, own, hostile-but-no-exclusion
      state: [STATE_OPERATIONAL, STATE_OPERATIONAL, STATE_OPERATIONAL],
    });
    const circles = hostileExcluders(db, hostile, [live, undefined]);
    expect(circles).toEqual([
      { cx: 20 + OUTPOST.footprint.w / 2, cy: 40 + OUTPOST.footprint.h / 2, r: OUTPOST.exclusion },
    ]);
  });

  it('merges memory rows and skips ruins', () => {
    const memory = rows({
      kind: [OUTPOST.index, OUTPOST.index],
      x: [20, 50],
      y: [40, 40],
      faction: [2, 0],
      state: [STATE_OPERATIONAL, STATE_RUIN],
    });
    const circles = hostileExcluders(db, hostile, [memory]);
    expect(circles.length).toBe(1);
    expect(circles[0]?.r).toBe(OUTPOST.exclusion);
  });
});
