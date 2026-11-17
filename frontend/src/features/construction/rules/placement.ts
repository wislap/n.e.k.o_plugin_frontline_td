// Shared placement rules (ADR 0012): pure footprint and range checks used
// by the sim (authoritative) and the client preview (batch D). The view
// interface is designed so a snapshot-backed adapter can implement it.

export interface PlacementRule {
  w: number;
  h: number;
  // Node structures must link to a completed own node; others only need
  // service coverage.
  node: boolean;
  connect: number;
  // Required surface deposit cargo index, -1 when none (batch C).
  requiresDeposit: number;
}

export interface PlacementView {
  width: number;
  height: number;
  // Ground-class static passability; the dynamic blocked overlay is
  // reported separately via blocked() so 'terrain' and 'occupied' stay
  // distinct.
  passable(x: number, y: number): boolean;
  heightAt(x: number, y: number): number;
  isRamp(x: number, y: number): boolean;
  // Dynamic blocked overlay (structures).
  blocked(x: number, y: number): boolean;
  reservedByOwn(x: number, y: number): boolean;
  covered(x: number, y: number): boolean;
  // Surface deposit cargo index at the cell, -1 when none (batch C).
  depositAt(x: number, y: number): number;
  connects(rule: PlacementRule, x: number, y: number): boolean;
}

export const FOOTPRINT_CODES = [
  'ok',
  'out_of_bounds',
  'terrain',
  'uneven',
  'occupied',
  'reserved',
  'needs_deposit',
] as const;
export type FootprintCode = (typeof FOOTPRINT_CODES)[number];

export const RANGE_CODES = ['ok', 'not_covered', 'not_connected'] as const;
export type RangeCode = (typeof RANGE_CODES)[number];

// One pass per check category so the reason precedence is the code
// order above, independent of which cell fails first.
export function checkFootprint(
  rule: PlacementRule,
  x: number,
  y: number,
  view: PlacementView,
): FootprintCode {
  const cells = (visit: (cx: number, cy: number) => boolean): boolean => {
    for (let dy = 0; dy < rule.h; dy++) {
      for (let dx = 0; dx < rule.w; dx++) {
        if (!visit(x + dx, y + dy)) {
          return false;
        }
      }
    }
    return true;
  };
  if (!cells((cx, cy) => cx >= 0 && cy >= 0 && cx < view.width && cy < view.height)) {
    return 'out_of_bounds';
  }
  if (!cells((cx, cy) => view.passable(cx, cy) && !view.isRamp(cx, cy))) {
    return 'terrain';
  }
  const h0 = view.heightAt(x, y);
  if (!cells((cx, cy) => view.heightAt(cx, cy) === h0)) {
    return 'uneven';
  }
  if (!cells((cx, cy) => !view.blocked(cx, cy))) {
    return 'occupied';
  }
  if (!cells((cx, cy) => !view.reservedByOwn(cx, cy))) {
    return 'reserved';
  }
  // needs_deposit when NO footprint cell carries the required deposit.
  if (
    rule.requiresDeposit >= 0 &&
    cells((cx, cy) => view.depositAt(cx, cy) !== rule.requiresDeposit)
  ) {
    return 'needs_deposit';
  }
  return 'ok';
}

export function checkRange(
  rule: PlacementRule,
  x: number,
  y: number,
  view: PlacementView,
): RangeCode {
  if (rule.node) {
    return view.connects(rule, x, y) ? 'ok' : 'not_connected';
  }
  const cx = x + Math.floor(rule.w / 2);
  const cy = y + Math.floor(rule.h / 2);
  return view.covered(cx, cy) ? 'ok' : 'not_covered';
}
