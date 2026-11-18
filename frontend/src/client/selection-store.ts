// Selection + command-feedback UI state (M2 C6). Holds unit HANDLES (never
// raw entity ids) and a short-lived move-target marker.
import { create } from 'zustand';

export interface SelectionState {
  selected: ReadonlySet<number>;
  // Last right-click move target, for the short-lived ground marker.
  moveMarker: { x: number; y: number; at: number } | null;
  setSelection(handles: ReadonlySet<number>, additive: boolean): void;
  clear(): void;
  markMoveTarget(x: number, y: number, at: number): void;
  reset(): void;
}

// Drop handles that no longer appear in the latest snapshot channel.
export function pruneSelected(
  selected: ReadonlySet<number>,
  valid: ReadonlySet<number>,
): Set<number> {
  const next = new Set<number>();
  for (const handle of selected) {
    if (valid.has(handle)) {
      next.add(handle);
    }
  }
  return next;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: new Set<number>(),
  moveMarker: null,
  setSelection: (handles, additive) => {
    set((state) => {
      if (!additive) {
        return { selected: new Set(handles) };
      }
      const next = new Set(state.selected);
      for (const h of handles) {
        next.add(h);
      }
      return { selected: next };
    });
  },
  clear: () => {
    set({ selected: new Set<number>() });
  },
  markMoveTarget: (x, y, at) => {
    set({ moveMarker: { x, y, at } });
  },
  reset: () => {
    set({ selected: new Set<number>(), moveMarker: null });
  },
}));
