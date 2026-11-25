// Minimap model tests: projection round-trips and clamping, and
// spectate/tactical viewport projection parity. Feature-owned
// compositing and entity-collection cases moved to features/*/ui and
// app tests (ADR 0062 step 4a).
import { describe, expect, it } from 'vitest';
import { matchZoomForMode } from './camera-math';
import {
  canvasToMap,
  clipPolygonToRect,
  computeMinimapFrustumQuad,
  computeMinimapViewport,
  mapToCanvas,
} from './minimap-model';

describe('canvasToMap & mapToCanvas', () => {
  it('round-trips interior points accurately', () => {
    const mapPt = canvasToMap(75, 45, 200, 120, 64, 48);
    expect(mapPt.x).toBeCloseTo(24, 5);
    expect(mapPt.y).toBeCloseTo(18, 5);

    const back = mapToCanvas(mapPt.x, mapPt.y, 200, 120, 64, 48);
    expect(back.x).toBeCloseTo(75, 5);
    expect(back.y).toBeCloseTo(45, 5);
  });

  it('clamps out-of-bounds pixels so Math.floor stays in [0 .. dim - 1]', () => {
    const neg = canvasToMap(-5, -5, 200, 160, 64, 48);
    expect(neg.x).toBe(0);
    expect(neg.y).toBe(0);
    expect(Math.floor(neg.x)).toBe(0);
    expect(Math.floor(neg.y)).toBe(0);

    const edge = canvasToMap(200, 160, 200, 160, 64, 48);
    expect(Math.floor(edge.x)).toBe(63);
    expect(Math.floor(edge.y)).toBe(47);

    const over = canvasToMap(500, 500, 200, 160, 64, 48);
    expect(Math.floor(over.x)).toBe(63);
    expect(Math.floor(over.y)).toBe(47);
  });

  it('handles zero or non-positive canvas and map sizes safely', () => {
    const zeroW = canvasToMap(10, 10, 0, 100, 64, 48);
    expect(zeroW.x).toBe(0);
    expect(zeroW.y).toBeCloseTo(4.8, 6);
    const zeroH = canvasToMap(10, 10, 100, 0, 64, 48);
    expect(zeroH.x).toBeCloseTo(6.4, 6);
    expect(zeroH.y).toBe(0);
    expect(canvasToMap(10, 10, 100, 100, 0, 0)).toEqual({ x: 0, y: 0 });
    const mapZeroW = mapToCanvas(10, 10, 0, 100, 64, 48);
    expect(mapZeroW.x).toBe(0);
    expect(mapZeroW.y).toBeCloseTo(20.833333, 5);
    expect(mapToCanvas(10, 10, 100, 100, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('computeMinimapViewport', () => {
  it('preserves vertical ground span across spectate and tactical via matchZoomForMode', () => {
    const spectateZoom = 34;
    const tacticalZoom = matchZoomForMode('tactical', spectateZoom);
    const aspect = 16 / 9;

    const spectateRect = computeMinimapViewport('spectate', { x: 40, y: 30 }, spectateZoom, aspect);
    const tacticalRect = computeMinimapViewport('tactical', { x: 40, y: 30 }, tacticalZoom, aspect);

    expect(tacticalRect.h).toBeCloseTo(spectateRect.h, 6);
    expect(tacticalRect.x + tacticalRect.w / 2).toBeCloseTo(40, 6);
    expect(tacticalRect.y + tacticalRect.h / 2).toBeCloseTo(30, 6);
    expect(spectateRect.x + spectateRect.w / 2).toBeCloseTo(40, 6);
    expect(spectateRect.y + spectateRect.h / 2).toBeCloseTo(30, 6);
  });

  it('falls back to 16:9 aspect when viewportAspect is invalid or non-positive', () => {
    const fallback = computeMinimapViewport('tactical', { x: 20, y: 20 }, 24, 0);
    const explicit = computeMinimapViewport('tactical', { x: 20, y: 20 }, 24, 16 / 9);
    expect(fallback).toEqual(explicit);
    expect(fallback.w).toBeCloseTo(24 * (16 / 9), 6);
    expect(fallback.h).toBe(24);
  });

  it('computeMinimapFrustumQuad draws symmetric rotated tactical boxes and widening 3D trapezoids', () => {
    const quad0 = computeMinimapFrustumQuad('spectate', { x: 40, y: 30 }, 30, 0, 0, 16 / 9);
    const nearW = Math.hypot(quad0[1].x - quad0[0].x, quad0[1].y - quad0[0].y);
    const farW = Math.hypot(quad0[2].x - quad0[3].x, quad0[2].y - quad0[3].y);
    expect(farW).toBeGreaterThan(nearW);
    expect(farW / nearW).toBeLessThan(1.6);
    // At yaw = 0, near edge lies south of center and far edge north of center.
    expect(quad0[0].y).toBeGreaterThan(30);
    expect(quad0[3].y).toBeLessThan(30);

    // At arbitrary yaw and lowest pitch floor (26 deg), edges stay parallel,
    // sides remain symmetric, and horizon flare is bounded without blow-up.
    const quadLow = computeMinimapFrustumQuad(
      'spectate',
      { x: 40, y: 30 },
      30,
      Math.PI / 5,
      -30,
      16 / 9,
    );
    const lowNearW = Math.hypot(quadLow[1].x - quadLow[0].x, quadLow[1].y - quadLow[0].y);
    const lowFarW = Math.hypot(quadLow[2].x - quadLow[3].x, quadLow[2].y - quadLow[3].y);
    const sideLeft = Math.hypot(quadLow[3].x - quadLow[0].x, quadLow[3].y - quadLow[0].y);
    const sideRight = Math.hypot(quadLow[2].x - quadLow[1].x, quadLow[2].y - quadLow[1].y);
    expect(sideLeft).toBeCloseTo(sideRight, 6);
    expect(lowFarW / lowNearW).toBeGreaterThan(farW / nearW);
    expect(lowFarW / lowNearW).toBeLessThan(2.5);
    // Near and far edge directions stay parallel.
    const nearDx = (quadLow[1].x - quadLow[0].x) / lowNearW;
    const nearDy = (quadLow[1].y - quadLow[0].y) / lowNearW;
    const farDx = (quadLow[2].x - quadLow[3].x) / lowFarW;
    const farDy = (quadLow[2].y - quadLow[3].y) / lowFarW;
    expect(nearDx * farDy - nearDy * farDx).toBeCloseTo(0, 6);

    // At yaw = +90 deg (looking East), near edge lies West of center and far edge East.
    const quadEast = computeMinimapFrustumQuad(
      'tactical',
      { x: 40, y: 30 },
      24,
      Math.PI / 2,
      0,
      16 / 9,
    );
    expect(quadEast[0].x).toBeLessThan(40);
    expect(quadEast[2].x).toBeGreaterThan(40);
    const tacNearW = Math.hypot(quadEast[1].x - quadEast[0].x, quadEast[1].y - quadEast[0].y);
    expect(tacNearW).toBeCloseTo(24 * (16 / 9), 5);
  });

  it('clipPolygonToRect keeps interior quads intact and closes border-crossing polygons', () => {
    const interior = [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 50, y: 10 },
      { x: 5, y: 10 },
    ];
    expect(clipPolygonToRect(interior, 0, 0, 100, 100)).toEqual(interior);

    // Partially off bottom-left edge (e.g. spawn view near (14, 52)): every
    // output vertex stays inside the rect so the polygon border stays closed.
    const partial = [
      { x: -10, y: 110 },
      { x: 60, y: 110 },
      { x: 80, y: 70 },
      { x: -20, y: 70 },
    ];
    const clippedPartial = clipPolygonToRect(partial, 1, 1, 195, 129);
    expect(clippedPartial.length).toBeGreaterThanOrEqual(4);
    for (const pt of clippedPartial) {
      expect(pt.x).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(pt.x).toBeLessThanOrEqual(195 + 1e-6);
      expect(pt.y).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(pt.y).toBeLessThanOrEqual(129 + 1e-6);
    }

    // Oversized quad enclosing the entire minimap clips to the exact rectangle.
    const huge = [
      { x: -50, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: -50 },
      { x: -50, y: -50 },
    ];
    expect(clipPolygonToRect(huge, 1, 1, 195, 129)).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 129 },
      { x: 195, y: 129 },
      { x: 195, y: 1 },
    ]);
  });
});
