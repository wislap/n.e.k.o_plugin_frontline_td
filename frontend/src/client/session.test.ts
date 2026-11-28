// resetClientState: restart drops every per-match client store, clears
// cursorState, and invokes registered session reset callbacks.
import { describe, expect, it, vi } from 'vitest';
import { useBoxStore } from './box-store';
import { useCameraStore } from './camera-store';
import { cursorState } from './cursor';
import { useInspectorStore } from './inspector-store';
import { useInteractionStore } from './interaction-store';
import { useRuntimeStore } from './runtime-store';
import { useSelectionStore } from './selection-store';
import { registerSessionReset, resetClientState } from './session';
import { useUiStore } from './ui-store';

describe('resetClientState', () => {
  it('returns all client stores, cursor trackers, and registered callbacks to defaults', () => {
    const onReset = vi.fn();
    registerSessionReset(onReset);

    useSelectionStore.getState().setSelection(new Set([1, 2]), false);
    useSelectionStore.getState().markMoveTarget(3, 4, 5);
    useInspectorStore.getState().setHovered({ kind: 'cell', x: 2, y: 3 });
    useInspectorStore.getState().pin({ kind: 'own_unit', handle: 1 });
    useInteractionStore.getState().enterPlace('frontline_td:turret');
    useInteractionStore.getState().setGhost({ x: 1, y: 2, code: 'ok' });
    useInteractionStore.getState().armDemolishConfirm([1, 2], 500);
    useBoxStore.getState().setBox({ x0: 0, y0: 0, x1: 9, y1: 9 });
    useUiStore.getState().toggleDebugPanel();
    useUiStore.getState().setGpuPerObject(true);
    useUiStore.getState().toggleLogisticsOverlay();
    useUiStore.getState().toggleKeymapHelp();
    useUiStore.getState().toggleMinimap();
    expect(useUiStore.getState().debugPanelOpen).toBe(true);
    expect(useUiStore.getState().gpuPerObject).toBe(true);
    expect(useUiStore.getState().keymapHelpOpen).toBe(true);
    expect(useUiStore.getState().minimapOpen).toBe(false);
    useCameraStore.getState().setCenter({ x: 40, y: 40 });
    useCameraStore.getState().toggleMode();
    useCameraStore.getState().setLocked(true);
    useRuntimeStore.getState().setError('old crash');
    cursorState.setGround({ x: 11, y: 12 });
    cursorState.setScreen(7, 8);

    resetClientState();

    expect(useSelectionStore.getState().selected.size).toBe(0);
    expect(useSelectionStore.getState().moveMarker).toBeNull();
    expect(useInspectorStore.getState().hovered).toBeNull();
    expect(useInspectorStore.getState().pinned).toBeNull();
    const interaction = useInteractionStore.getState();
    expect(interaction.mode).toBe('command');
    expect(interaction.tool).toEqual({ kind: 'none' });
    expect(interaction.ghost).toBeNull();
    expect(interaction.demolishConfirm).toBeNull();
    expect(interaction.demolishHover).toBeNull();
    expect(useBoxStore.getState().box).toBeNull();
    const ui = useUiStore.getState();
    expect(ui.debugPanelOpen).toBe(false);
    expect(ui.gpuPerObject).toBe(false);
    expect(ui.logisticsOverlay).toBe(false);
    expect(ui.keymapHelpOpen).toBe(false);
    expect(ui.minimapOpen).toBe(true);
    const camera = useCameraStore.getState();
    expect(camera.mode).toBe('spectate');
    expect(camera.autoSwitch).toBe(false);
    expect(camera.locked).toBe(false);
    const runtime = useRuntimeStore.getState();
    expect(runtime.stats).toBeNull();
    expect(runtime.error).toBeNull();
    expect(cursorState.ground()).toEqual({ x: 0, y: 0, valid: false });
    expect(cursorState.screen()).toEqual({ x: 0, y: 0 });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
