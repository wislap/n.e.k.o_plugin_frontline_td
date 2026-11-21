import { beforeEach, describe, expect, it } from 'vitest';
import { useCameraStore } from './camera-store';
import { visibleGroundHeight } from './camera-math';

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
});
