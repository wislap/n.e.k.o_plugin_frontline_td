import { beforeEach, describe, expect, it } from 'vitest';
import { useCameraStore } from './camera-store';
import { visibleGroundHeight } from './camera-math';

describe('camera store', () => {
  beforeEach(() => {
    useCameraStore.setState({
      mode: 'spectate',
      center: { x: 0, y: 0 },
      zoom: 30,
      autoSwitch: false,
      autoTacticalOnPause: true,
    });
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
});
