import { describe, expect, it } from 'vitest';
import {
  SPECTATE_DEFAULT_DIST,
  SPECTATE_FOV_DEG,
  SPECTATE_MAX_DIST,
  SPECTATE_MAX_PITCH_DEG,
  SPECTATE_MIN_DIST,
  SPECTATE_MIN_PITCH_DEG,
  SPECTATE_PITCH_DEG,
  TACTICAL_MAX_HEIGHT,
  TACTICAL_MIN_HEIGHT,
  baseSpectatePitchDeg,
  clampCenter,
  clampPitchOffsetForDist,
  clampSpectateDist,
  clampSpectatePitch,
  clampTacticalHeight,
  compassHeadingDeg,
  easeInOut,
  effectiveSpectatePitchDeg,
  frameDampingAlpha,
  intersectHorizontalPlane,
  matchZoomForMode,
  nearestNorthYaw,
  orbitalCameraPose,
  orthoClipPlanes,
  orthoHeightForPerspectiveDist,
  perspectiveClipPlanes,
  perspectiveDistAtPitch,
  perspectiveDistForOrthoHeight,
  rotatePanVector,
  screenUpDir,
  spectateCameraPosition,
  spectateCursorGroundOffset,
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

  it('perspectiveClipPlanes tightens near with distance and expands far for large maps', () => {
    const close = perspectiveClipPlanes(SPECTATE_MIN_DIST, 96, 64);
    expect(close.near).toBeCloseTo(SPECTATE_MIN_DIST * 0.12, 6);
    expect(close.far).toBe(500);

    // Distances below SPECTATE_MIN_DIST clamp to SPECTATE_MIN_DIST.
    expect(perspectiveClipPlanes(1, 96, 64)).toEqual(close);

    // Mid-distance scales near linearly until capped at 8.
    const mid = perspectiveClipPlanes(40, 96, 64);
    expect(mid.near).toBeCloseTo(4.8, 6);
    expect(mid.far).toBe(500);

    const farZoom = perspectiveClipPlanes(80, 96, 64);
    expect(farZoom.near).toBe(8);
    expect(farZoom.far).toBe(500);

    // Large maps push far beyond the 500 floor.
    const hugeMap = perspectiveClipPlanes(80, 400, 300);
    expect(hugeMap.near).toBe(8);
    expect(hugeMap.far).toBeCloseTo(80 + 500 + 120, 6);

    // Degenerate zero/negative map sizes clamp to 1x1 without NaN.
    const tiny = perspectiveClipPlanes(10, 0, -5);
    expect(tiny.near).toBeCloseTo(1.2, 6);
    expect(tiny.far).toBe(500);
  });

  it('orthoClipPlanes sets near=1 and expands far when cameraY grows', () => {
    expect(orthoClipPlanes(200)).toEqual({ near: 1, far: 300 });
    expect(orthoClipPlanes(220)).toEqual({ near: 1, far: 300 });
    expect(orthoClipPlanes(300)).toEqual({ near: 1, far: 380 });
  });

  it('smart dolly-pitch lowers pitch close-in, hits 55° at default, and prevents offset wind-up', () => {
    expect(baseSpectatePitchDeg(SPECTATE_MIN_DIST)).toBeCloseTo(34, 6);
    expect(baseSpectatePitchDeg(SPECTATE_DEFAULT_DIST)).toBeCloseTo(SPECTATE_PITCH_DEG, 6);
    expect(baseSpectatePitchDeg(SPECTATE_MAX_DIST)).toBeCloseTo(72, 6);
    expect(clampSpectatePitch(5)).toBe(SPECTATE_MIN_PITCH_DEG);
    expect(clampSpectatePitch(89)).toBe(SPECTATE_MAX_PITCH_DEG);

    // Dragging beyond limits clamps effective pitch without winding up offset.
    const clampedLo = clampPitchOffsetForDist(SPECTATE_MIN_DIST, -50);
    expect(effectiveSpectatePitchDeg(SPECTATE_MIN_DIST, clampedLo)).toBe(SPECTATE_MIN_PITCH_DEG);
    expect(clampedLo).toBeCloseTo(SPECTATE_MIN_PITCH_DEG - 34, 6);

    const clampedHi = clampPitchOffsetForDist(SPECTATE_MAX_DIST, 50);
    expect(effectiveSpectatePitchDeg(SPECTATE_MAX_DIST, clampedHi)).toBe(SPECTATE_MAX_PITCH_DEG);
    expect(clampedHi).toBeCloseTo(SPECTATE_MAX_PITCH_DEG - 72, 6);
  });

  it('matchZoomForMode preserves ground extent round-trip across custom pitch offsets', () => {
    for (const pitchOffset of [-15, 0, 15]) {
      const spectateZoom = 34;
      const tacticalZoom = matchZoomForMode('tactical', spectateZoom, pitchOffset);
      expect(visibleGroundHeight('tactical', tacticalZoom, pitchOffset)).toBeCloseTo(
        visibleGroundHeight('spectate', spectateZoom, pitchOffset),
        6,
      );
      const back = matchZoomForMode('spectate', tacticalZoom, pitchOffset);
      expect(back).toBeCloseTo(spectateZoom, 5);
    }
  });

  it('orbitalCameraPose produces an orthonormal right-handed frame with zero singularity at 90°', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const pitchDeg of [26, 55, 90]) {
        const pose = orbitalCameraPose({ x: 20, y: 15 }, 1.5, 25, yaw, pitchDeg);
        const fLen = Math.hypot(pose.forward.x, pose.forward.y, pose.forward.z);
        const rLen = Math.hypot(pose.right.x, pose.right.y, pose.right.z);
        const uLen = Math.hypot(pose.up.x, pose.up.y, pose.up.z);
        expect(fLen).toBeCloseTo(1, 6);
        expect(rLen).toBeCloseTo(1, 6);
        expect(uLen).toBeCloseTo(1, 6);
        // Orthogonal basis
        expect(
          pose.forward.x * pose.right.x +
            pose.forward.y * pose.right.y +
            pose.forward.z * pose.right.z,
        ).toBeCloseTo(0, 6);
        expect(
          pose.forward.x * pose.up.x + pose.forward.y * pose.up.y + pose.forward.z * pose.up.z,
        ).toBeCloseTo(0, 6);
        expect(
          pose.right.x * pose.up.x + pose.right.y * pose.up.y + pose.right.z * pose.up.z,
        ).toBeCloseTo(0, 6);
        // Right-handed: forward x up = right
        expect(pose.forward.y * pose.up.z - pose.forward.z * pose.up.y).toBeCloseTo(
          pose.right.x,
          6,
        );
        expect(pose.forward.z * pose.up.x - pose.forward.x * pose.up.z).toBeCloseTo(
          pose.right.y,
          6,
        );
        expect(pose.forward.x * pose.up.y - pose.forward.y * pose.up.x).toBeCloseTo(
          pose.right.z,
          6,
        );
        // Camera looks back through the focus point (center.x, centerY, center.y)
        expect(pose.position.x + pose.forward.x * 25).toBeCloseTo(20, 6);
        expect(pose.position.y + pose.forward.y * 25).toBeCloseTo(1.5, 6);
        expect(pose.position.z + pose.forward.z * 25).toBeCloseTo(15, 6);
      }
    }
  });

  it('rotatePanVector aligns screen WASD directions with camera yaw', () => {
    // Yaw = 0 (North): W (0, -1) -> North (0, -1), D (1, 0) -> East (1, 0).
    expect(rotatePanVector({ x: 0, y: -1 }, 0)).toEqual({ x: 0, y: -1 });
    expect(rotatePanVector({ x: 1, y: 0 }, 0)).toEqual({ x: 1, y: 0 });
    // Yaw = +90° (East): W (0, -1) -> East (1, 0), D (1, 0) -> South (0, 1).
    const eastFwd = rotatePanVector({ x: 0, y: -1 }, Math.PI / 2);
    expect(eastFwd.x).toBeCloseTo(1, 6);
    expect(eastFwd.y).toBeCloseTo(0, 6);
    const eastRight = rotatePanVector({ x: 1, y: 0 }, Math.PI / 2);
    expect(eastRight.x).toBeCloseTo(0, 6);
    expect(eastRight.y).toBeCloseTo(1, 6);
    // Yaw = 180° (South): W -> South (0, 1).
    const southFwd = rotatePanVector({ x: 0, y: -1 }, Math.PI);
    expect(southFwd.x).toBeCloseTo(0, 6);
    expect(southFwd.y).toBeCloseTo(1, 6);
    // Yaw = -90° (West): W -> West (-1, 0).
    const westFwd = rotatePanVector({ x: 0, y: -1 }, -Math.PI / 2);
    expect(westFwd.x).toBeCloseTo(-1, 6);
    expect(westFwd.y).toBeCloseTo(0, 6);
  });

  it('nearestNorthYaw snaps to nearest 2pi turn and compassHeadingDeg normalizes multiples of 360°', () => {
    expect(nearestNorthYaw(0.4)).toBe(0);
    expect(nearestNorthYaw(-Math.PI * 0.9)).toBe(0);
    expect(nearestNorthYaw(Math.PI * 1.9)).toBeCloseTo(Math.PI * 2, 6);
    expect(nearestNorthYaw(-Math.PI * 2.1)).toBeCloseTo(-Math.PI * 2, 6);
    expect(compassHeadingDeg(0)).toBe(0);
    expect(compassHeadingDeg(Math.PI * 2)).toBe(0);
    expect(compassHeadingDeg(-Math.PI * 4)).toBe(0);
    expect(compassHeadingDeg(Math.PI * 0.5)).toBe(90);
    expect(compassHeadingDeg(Math.PI)).toBe(180);
    expect(compassHeadingDeg(-Math.PI * 0.5)).toBe(-90);
  });

  it('intersectHorizontalPlane and spectateCursorGroundOffset anchor ground rays cleanly', () => {
    expect(
      intersectHorizontalPlane({ origin: { x: 10, y: 20, z: 30 }, dir: { x: 0, y: -1, z: 0 } }, 2),
    ).toEqual({ x: 10, y: 30 });
    // Grazing upward / flat rays are rejected.
    expect(
      intersectHorizontalPlane({ origin: { x: 0, y: 5, z: 0 }, dir: { x: 1, y: 0, z: 0 } }, 0),
    ).toBeNull();
    expect(
      intersectHorizontalPlane({ origin: { x: 0, y: 5, z: 0 }, dir: { x: 1, y: -0.02, z: 0 } }, 0),
    ).toBeNull();

    // Center NDC (0, 0) looking at plane Y = centerY has zero offset.
    const centerOffset = spectateCursorGroundOffset(0, 0, 16 / 9, 30, 0.8, 55, 1, 1);
    expect(centerOffset).not.toBeNull();
    expect(centerOffset?.x).toBeCloseTo(0, 6);
    expect(centerOffset?.y).toBeCloseTo(0, 6);

    expect(frameDampingAlpha(0, 0.05)).toBe(0);
    expect(frameDampingAlpha(0.05, 0.05)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(frameDampingAlpha(0.016, 0)).toBe(1);
  });
});
