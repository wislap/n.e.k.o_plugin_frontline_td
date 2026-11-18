// resetClientState: restart drops every per-match client store and the
// mutable cursor trackers back to their initial values.
import { describe, expect, it } from 'vitest';
import { useBoxStore } from './box-store';
import { useBuildStore } from './build-store';
import { useCameraStore } from './camera-store';
import { cursorGround, cursorScreen } from './cursor';
import { resetClientState } from './reset';
import { useRuntimeStore } from './runtime-store';
import { useSelectionStore } from './selection-store';
import { useUiStore } from './ui-store';

describe('resetClientState', () => {
  it('returns all client stores and cursor trackers to defaults', () => {
    useSelectionStore.getState().setSelection(new Set([1, 2]), false);
    useSelectionStore.getState().markMoveTarget(3, 4, 5);
    useBuildStore.getState().select('frontline_td:turret');
    useBuildStore.getState().setGhost({ x: 1, y: 2, code: 'ok' });
    useBoxStore.getState().setBox({ x0: 0, y0: 0, x1: 9, y1: 9 });
    useUiStore.getState().toggleDebugPanel();
    useUiStore.getState().toggleLogisticsOverlay();
    useCameraStore.getState().setCenter({ x: 40, y: 40 });
    useCameraStore.getState().toggleMode();
    useRuntimeStore.getState().setError('old crash');
    cursorGround.valid = true;
    cursorScreen.x = 7;
    cursorScreen.y = 8;

    resetClientState();

    expect(useSelectionStore.getState().selected.size).toBe(0);
    expect(useSelectionStore.getState().moveMarker).toBeNull();
    const build = useBuildStore.getState();
    expect(build.kind).toBeNull();
    expect(build.ghost).toBeNull();
    expect(build.roadMode).toBe(false);
    expect(build.roadSel).toEqual([]);
    expect(build.roadHover).toBe(-1);
    expect(useBoxStore.getState().box).toBeNull();
    const ui = useUiStore.getState();
    expect(ui.debugPanelOpen).toBe(true);
    expect(ui.logisticsOverlay).toBe(false);
    const camera = useCameraStore.getState();
    expect(camera.mode).toBe('spectate');
    expect(camera.autoSwitch).toBe(false);
    const runtime = useRuntimeStore.getState();
    expect(runtime.stats).toBeNull();
    expect(runtime.error).toBeNull();
    expect(cursorGround.valid).toBe(false);
    expect(cursorScreen).toEqual({ x: 0, y: 0 });
  });
});
