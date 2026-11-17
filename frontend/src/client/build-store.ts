// Build-mode UI state (M3 D): the selected structure content id, or null.
// The ghost's last evaluated placement code is mirrored here (updated by
// the preview layer only when it changes) so the HUD can localize it.
import { create } from 'zustand';

export interface BuildState {
  // Structure content id while build mode is active, else null.
  kind: string | null;
  // Last ghost evaluation: top-left cell + combined reason code
  // ('ok' or a footprint/range code). Null when the cursor is off-map.
  ghost: { x: number; y: number; code: string } | null;
  select(kind: string): void;
  cancel(): void;
  setGhost(ghost: BuildState['ghost']): void;
}

export const useBuildStore = create<BuildState>((set) => ({
  kind: null,
  ghost: null,
  select: (kind) => {
    set({ kind });
  },
  cancel: () => {
    set({ kind: null, ghost: null });
  },
  setGhost: (ghost) => {
    set({ ghost });
  },
}));
