import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMOLISH_CONFIRM_MS, targetKeyForHandles, useInteractionStore } from './interaction-store';
import { useSelectionStore } from './selection-store';

describe('interaction store', () => {
  beforeEach(() => {
    useInteractionStore.getState().reset();
    useSelectionStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in command mode with no tool active', () => {
    const state = useInteractionStore.getState();
    expect(state.mode).toBe('command');
    expect(state.tool).toEqual({ kind: 'none' });
    expect(state.ghost).toBeNull();
    expect(state.demolishConfirm).toBeNull();
    expect(state.demolishHover).toBeNull();
    expect(state.roadSel).toEqual([]);
    expect(state.roadHover).toBe(-1);
  });

  it('enters place tool, clears ghost only when structure kind changes, and exits tool cleanly', () => {
    const store = useInteractionStore.getState();
    store.enterPlace('frontline_td:turret');
    expect(useInteractionStore.getState().mode).toBe('build');
    expect(useInteractionStore.getState().tool).toEqual({
      kind: 'place',
      structureKindId: 'frontline_td:turret',
    });

    store.setGhost({ x: 3, y: 4, code: 'ok' });
    store.enterPlace('frontline_td:turret');
    expect(useInteractionStore.getState().ghost).toEqual({ x: 3, y: 4, code: 'ok' });

    store.enterPlace('frontline_td:depot');
    expect(useInteractionStore.getState().ghost).toBeNull();

    store.setGhost({ x: 5, y: 6, code: 'occupied' });
    store.exitTool();
    expect(useInteractionStore.getState().mode).toBe('build');
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'none' });
    expect(useInteractionStore.getState().ghost).toBeNull();
  });

  it('switches between demolish, road, and primary modes while clearing transient tool state', () => {
    const store = useInteractionStore.getState();
    store.enterPlace('frontline_td:turret');
    store.setGhost({ x: 1, y: 2, code: 'ok' });
    store.enterDemolish();
    expect(useInteractionStore.getState().mode).toBe('build');
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'demolish' });
    expect(useInteractionStore.getState().ghost).toBeNull();

    store.setDemolishHover({ handle: 10, refunds: [{ cargo: 0, milli: 500 }] });
    store.enterRoad();
    expect(useInteractionStore.getState().mode).toBe('logistics');
    expect(useInteractionStore.getState().tool).toEqual({ kind: 'road' });
    expect(useInteractionStore.getState().demolishHover).toBeNull();

    store.toggleRoadLink({ a: 2, b: 5 });
    store.toggleRoadLink({ a: 1, b: 3 });
    expect(useInteractionStore.getState().roadSel).toEqual([
      { a: 1, b: 3 },
      { a: 2, b: 5 },
    ]);
    store.toggleRoadLink({ a: 1, b: 3 });
    expect(useInteractionStore.getState().roadSel).toEqual([{ a: 2, b: 5 }]);

    store.setRoadHover(3);
    store.setMode('command');
    const after = useInteractionStore.getState();
    expect(after.mode).toBe('command');
    expect(after.tool).toEqual({ kind: 'none' });
    expect(after.roadSel).toEqual([]);
    expect(after.roadHover).toBe(-1);
  });

  it('arms and clears demolish confirmation with normalized targetKey', () => {
    expect(targetKeyForHandles([9, 3, 9, 5])).toBe('3,5,9');
    useInteractionStore.getState().armDemolishConfirm([9, 3, 9, 5], 1000);
    expect(useInteractionStore.getState().demolishConfirm).toEqual({
      targetKey: '3,5,9',
      targets: [3, 5, 9],
      expiresAt: 1000 + DEMOLISH_CONFIRM_MS,
    });
    useInteractionStore.getState().clearDemolishConfirm();
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();
  });

  it('auto-expires demolishConfirm after DEMOLISH_CONFIRM_MS', () => {
    vi.useFakeTimers();
    useInteractionStore.getState().armDemolishConfirm([12], 1000);
    expect(useInteractionStore.getState().demolishConfirm).not.toBeNull();

    vi.advanceTimersByTime(DEMOLISH_CONFIRM_MS - 1);
    expect(useInteractionStore.getState().demolishConfirm).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();

    // Re-arming cancels the previous timer so it never clears the newer confirmation.
    useInteractionStore.getState().armDemolishConfirm([12], 2000);
    vi.advanceTimersByTime(1000);
    useInteractionStore.getState().armDemolishConfirm([13], 3000);
    vi.advanceTimersByTime(DEMOLISH_CONFIRM_MS - 1000);
    expect(useInteractionStore.getState().demolishConfirm?.targetKey).toBe('13');
    vi.advanceTimersByTime(1000);
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();
  });

  it('clears demolishConfirm when selection changes', () => {
    useSelectionStore.getState().setSelection(new Set([20]), false);
    useInteractionStore.getState().armDemolishConfirm([20], 1000);
    expect(useInteractionStore.getState().demolishConfirm).not.toBeNull();

    // Non-selection updates on selectionStore (moveMarker) keep demolishConfirm intact.
    useSelectionStore.getState().markMoveTarget(4, 5, 1100);
    expect(useInteractionStore.getState().demolishConfirm).not.toBeNull();

    // Selecting a different entity or clearing selection drops demolishConfirm.
    useSelectionStore.getState().setSelection(new Set([30]), false);
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();

    useInteractionStore.getState().armDemolishConfirm([30], 2000);
    useSelectionStore.getState().clear();
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();
  });
});
