import { describe, expect, it } from 'vitest';
import {
  SPECTATE_FOV_DEG,
  SPECTATE_MAX_DIST,
  SPECTATE_MIN_DIST,
  SPECTATE_PITCH_DEG,
  TACTICAL_MAX_HEIGHT,
  TACTICAL_MIN_HEIGHT,
  clampCenter,
  clampSpectateDist,
  clampTacticalHeight,
  easeInOut,
  matchZoomForMode,
  orthoHeightForPerspectiveDist,
  perspectiveDistAtPitch,
  perspectiveDistForOrthoHeight,
  screenUpDir,
  spectateCameraPosition,
  spectateViewDir,
  visibleGroundHeight,
} from './camera-math';

describe('camera math', () => {
  it('perspective dist ↔ ortho height are inverses at pitch 90°', () => {
    for (const h of [10, 30, 80]) {
      const d = perspectiveDistForOrthoHeight(h);
      expect(orthoHeightForPerspectiveDist(d)).toBeCloseTo(h, 6);
      // At pitch 90° the animation-distance formula agrees.
      expect(perspectiveDistAtPitch(h, 90)).toBeCloseTo(d, 6);
    }
  });

  it('mode zoom matching preserves the visible ground extent', () => {
    const spectateZoom = 40;
    const tacticalZoom = matchZoomForMode('tactical', spectateZoom);
    expect(visibleGroundHeight('tactical', tacticalZoom)).toBeCloseTo(
      visibleGroundHeight('spectate', spectateZoom),
      6,
    );
    const back = matchZoomForMode('spectate', tacticalZoom);
    expect(visibleGroundHeight('spectate', back)).toBeCloseTo(
      visibleGroundHeight('tactical', tacticalZoom),
      6,
    );
    expect(back).toBeCloseTo(spectateZoom, 6);
  });

  it('clamps zoom to each mode’s range', () => {
    expect(clampSpectateDist(1)).toBe(SPECTATE_MIN_DIST);
    expect(clampSpectateDist(1000)).toBe(SPECTATE_MAX_DIST);
    expect(clampTacticalHeight(1)).toBe(TACTICAL_MIN_HEIGHT);
    expect(clampTacticalHeight(1000)).toBe(TACTICAL_MAX_HEIGHT);
    expect(matchZoomForMode('spectate', TACTICAL_MAX_HEIGHT * 10)).toBe(SPECTATE_MAX_DIST);
  });

  it('clamps the center to the map bounds', () => {
    expect(clampCenter({ x: -5, y: 100 }, 96, 64)).toEqual({ x: 0, y: 64 });
    expect(clampCenter({ x: 50, y: 30 }, 96, 64)).toEqual({ x: 50, y: 30 });
  });

  it('positions the spectate camera south of the center at 55°', () => {
    const pos = spectateCameraPosition({ x: 10, y: 20 }, 20, SPECTATE_PITCH_DEG);
    expect(pos.x).toBe(10);
    expect(pos.z).toBeGreaterThan(20);
    const pitch = Math.atan2(pos.y, pos.z - 20);
    expect((pitch * 180) / Math.PI).toBeCloseTo(SPECTATE_PITCH_DEG, 4);
  });

  it('spectate keeps fov 45 in math constants', () => {
    expect(SPECTATE_FOV_DEG).toBe(45);
  });

  it('screen-up stays north-bound at every transition pitch (up = -Z)', () => {
    for (const pitch of [SPECTATE_PITCH_DEG, 89.9, 90]) {
      const up = screenUpDir(spectateViewDir(pitch));
      // Projected up = (0, cos p, -sin p): well defined, pointing up/north.
      const rad = (pitch * Math.PI) / 180;
      expect(up.x).toBeCloseTo(0, 6);
      expect(up.y).toBeCloseTo(Math.cos(rad), 4);
      expect(up.z).toBeCloseTo(-Math.sin(rad), 4);
      // Never degenerate.
      expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1, 6);
    }
    // At exactly 90° screen-up IS scene -Z.
    const top = screenUpDir(spectateViewDir(90));
    expect(top.x).toBeCloseTo(0, 10);
    expect(top.y).toBeCloseTo(0, 10);
    expect(top.z).toBeCloseTo(-1, 10);
  });

  it('easeInOut hits 0/1 at the ends and 0.5 in the middle', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});
