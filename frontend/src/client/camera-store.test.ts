import { beforeEach, describe, expect, it } from 'vitest';
import { useCameraStore } from './camera-store';
import {
  SPECTATE_MAX_PITCH_DEG,
  SPECTATE_MIN_PITCH_DEG,
  effectiveSpectatePitchDeg,
  spectateCursorGroundOffset,
  spectateFocusElevation,
  visibleGroundHeight,
} from './camera-math';

describe('camera store', () => {
  beforeEach(() => {
    useCameraStore.getState().reset();
  });

  it('setMode applies zoom matching so auto-switch keeps the visible extent', () => {
    const before = visibleGroundHeight('spectate', useCameraStore.getState().zoom);
    useCameraStore.getState().setMode('tactical', true);
    const mid = useCameraStore.getState();
    expect(mid.mode).toBe('tactical');
    expect(mid.autoSwitch).toBe(true);
    expect(visibleGroundHeight('tactical', mid.zoom)).toBeCloseTo(before, 6);
    useCameraStore.getState().setMode('spectate', false);
    const after = useCameraStore.getState();
    expect(after.mode).toBe('spectate');
    expect(after.autoSwitch).toBe(false);
    expect(visibleGroundHeight('spectate', after.zoom)).toBeCloseTo(before, 6);
  });

  it('toggleMode delegates to setMode and clears autoSwitch', () => {
    useCameraStore.getState().toggleMode();
    expect(useCameraStore.getState().mode).toBe('tactical');
    expect(useCameraStore.getState().autoSwitch).toBe(false);
  });

  it('setMode to the same mode only updates autoSwitch', () => {
    const zoom = useCameraStore.getState().zoom;
    useCameraStore.getState().setMode('spectate', true);
    expect(useCameraStore.getState().zoom).toBe(zoom);
    expect(useCameraStore.getState().autoSwitch).toBe(true);
  });

  it('syncForPrimaryMode auto-switches spectate to tactical on build/logistics and returns on command', () => {
    const store = useCameraStore.getState();
    store.syncForPrimaryMode('build');
    expect(useCameraStore.getState().mode).toBe('tactical');
    expect(useCameraStore.getState().autoSwitch).toBe(true);

    store.syncForPrimaryMode('logistics');
    expect(useCameraStore.getState().mode).toBe('tactical');
    expect(useCameraStore.getState().autoSwitch).toBe(true);

    store.syncForPrimaryMode('command');
    expect(useCameraStore.getState().mode).toBe('spectate');
    expect(useCameraStore.getState().autoSwitch).toBe(false);
  });

  it('syncForPrimaryMode preserves manual tactical mode and respects perspective lock', () => {
    const store = useCameraStore.getState();
    store.toggleMode();
    expect(useCameraStore.getState().mode).toBe('tactical');
    expect(useCameraStore.getState().autoSwitch).toBe(false);

    store.syncForPrimaryMode('build');
    expect(useCameraStore.getState().mode).toBe('tactical');
    expect(useCameraStore.getState().autoSwitch).toBe(false);

    store.syncForPrimaryMode('command');
    expect(useCameraStore.getState().mode).toBe('tactical');

    store.toggleMode();
    expect(useCameraStore.getState().mode).toBe('spectate');
    store.toggleLocked();
    expect(useCameraStore.getState().locked).toBe(true);

    store.syncForPrimaryMode('build');
    expect(useCameraStore.getState().mode).toBe('spectate');

    store.setLocked(false);
    store.syncForPrimaryMode('logistics');
    expect(useCameraStore.getState().mode).toBe('tactical');
  });

  it('orbitBy clamps pitch without wind-up, preserves yaw across mode swaps, and resetOrientation snaps shortest arc', () => {
    const store = useCameraStore.getState();
    store.orbitBy(Math.PI * 1.8, -100);
    let s = useCameraStore.getState();
    expect(effectiveSpectatePitchDeg(s.zoom, s.pitchOffsetDeg)).toBe(SPECTATE_MIN_PITCH_DEG);
    // Immediate upward drag responds immediately because wind-up was prevented.
    store.orbitBy(0, 10);
    s = useCameraStore.getState();
    expect(effectiveSpectatePitchDeg(s.zoom, s.pitchOffsetDeg)).toBeCloseTo(
      SPECTATE_MIN_PITCH_DEG + 10,
      6,
    );
    store.orbitBy(0, 200);
    s = useCameraStore.getState();
    expect(effectiveSpectatePitchDeg(s.zoom, s.pitchOffsetDeg)).toBe(SPECTATE_MAX_PITCH_DEG);

    // Yaw and visible ground extent are preserved across tactical <-> spectate swaps.
    const yawBefore = s.yaw;
    const extentBefore = visibleGroundHeight('spectate', s.zoom, s.pitchOffsetDeg);
    store.toggleMode();
    s = useCameraStore.getState();
    expect(s.mode).toBe('tactical');
    expect(s.yaw).toBeCloseTo(yawBefore, 6);
    expect(visibleGroundHeight('tactical', s.zoom, s.pitchOffsetDeg)).toBeCloseTo(extentBefore, 6);

    // Turning past pi snaps to nearest 2pi turn on resetOrientation.
    store.resetOrientation();
    s = useCameraStore.getState();
    expect(s.yaw).toBeCloseTo(Math.PI * 2, 6);
    expect(s.pitchOffsetDeg).toBe(0);
  });

  it('zoomToward preserves cursor ground anchoring across the terrain-follow zoom transition', () => {
    const store = useCameraStore.getState();
    store.setCenter({ x: 20, y: 40 });
    store.setZoom(24);
    const baseY = 0.1;
    const localSmoothY = 0.8;
    const planeY = 0.5;
    const ndcX = 0.25;
    const ndcY = -0.15;
    const aspect = 16 / 9;

    const cOld = spectateFocusElevation(24, baseY, localSmoothY);
    const qOld = spectateCursorGroundOffset(
      ndcX,
      ndcY,
      aspect,
      24,
      0,
      effectiveSpectatePitchDeg(24, 0),
      cOld,
      planeY,
    );
    expect(qOld).not.toBeNull();
    if (qOld === null) {
      throw new Error('Expected ground hit before zoom');
    }
    const worldHitBefore = { x: 20 + qOld.x, y: 40 + qOld.y };

    store.zoomToward(-10 / 24, worldHitBefore, {
      ndcX,
      ndcY,
      aspect,
      centerY: cOld,
      baseY,
      localSmoothY,
      planeY,
    });

    const after = useCameraStore.getState();
    expect(after.zoom).toBeCloseTo(14, 6);
    const cNext = spectateFocusElevation(after.zoom, baseY, localSmoothY);
    const qNext = spectateCursorGroundOffset(
      ndcX,
      ndcY,
      aspect,
      after.zoom,
      after.yaw,
      effectiveSpectatePitchDeg(after.zoom, after.pitchOffsetDeg),
      cNext,
      planeY,
    );
    expect(qNext).not.toBeNull();
    if (qNext === null) {
      throw new Error('Expected ground hit after zoom');
    }
    expect(after.center.x + qNext.x).toBeCloseTo(worldHitBefore.x, 5);
    expect(after.center.y + qNext.y).toBeCloseTo(worldHitBefore.y, 5);
  });
});
