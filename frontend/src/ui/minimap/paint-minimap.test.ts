import { describe, expect, it } from 'vitest';
import type { MinimapMarkDef } from './contributions';
import { isMinimapAnimating, MOVE_MARKER_MS } from './paint-minimap';

const isHostile = (observer: number, faction: number): boolean => faction !== observer;

function markDef(animating: boolean): MinimapMarkDef {
  return {
    id: 'test',
    order: 0,
    collect: () => [],
    isAnimating: () => animating,
  };
}

describe('isMinimapAnimating', () => {
  it('returns false when idle without active moveMarker or animating marks', () => {
    expect(
      isMinimapAnimating({
        moveMarker: null,
        nowMs: 1000,
        snapshot: null,
        isHostile,
        marks: [markDef(false), { id: 'static', order: 1, collect: () => [] }],
      }),
    ).toBe(false);
  });

  it('returns true only while moveMarker age is within [0, MOVE_MARKER_MS)', () => {
    expect(
      isMinimapAnimating({
        moveMarker: { x: 5, y: 5, at: 1000 },
        nowMs: 1000,
        snapshot: null,
        isHostile,
        marks: [],
      }),
    ).toBe(true);
    expect(
      isMinimapAnimating({
        moveMarker: { x: 5, y: 5, at: 1000 },
        nowMs: 1000 + MOVE_MARKER_MS - 1,
        snapshot: null,
        isHostile,
        marks: [],
      }),
    ).toBe(true);
    expect(
      isMinimapAnimating({
        moveMarker: { x: 5, y: 5, at: 1000 },
        nowMs: 1000 + MOVE_MARKER_MS,
        snapshot: null,
        isHostile,
        marks: [],
      }),
    ).toBe(false);
    expect(
      isMinimapAnimating({
        moveMarker: { x: 5, y: 5, at: 1000 },
        nowMs: 999,
        snapshot: null,
        isHostile,
        marks: [],
      }),
    ).toBe(false);
  });

  it('returns true when any mark reports isAnimating === true', () => {
    expect(
      isMinimapAnimating({
        moveMarker: null,
        nowMs: 1000,
        snapshot: null,
        isHostile,
        marks: [markDef(false), markDef(true)],
      }),
    ).toBe(true);
  });

  it('always returns false in captureMode', () => {
    expect(
      isMinimapAnimating({
        moveMarker: { x: 5, y: 5, at: 1000 },
        nowMs: 1100,
        snapshot: null,
        isHostile,
        marks: [markDef(true)],
        captureMode: true,
      }),
    ).toBe(false);
  });
});
