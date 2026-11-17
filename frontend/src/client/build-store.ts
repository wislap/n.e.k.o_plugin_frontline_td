// Build-mode UI state (M3 D + E3): the selected structure content id, or
// null; plus the road-upgrade tool mode with its selected link indices
// (indices into the network channel's links arrays). The ghost's last
// evaluated placement code is mirrored here (updated by the preview
// layer only when it changes) so the HUD can localize it.
import { create } from 'zustand';

export interface BuildState {
  // Structure content id while build mode is active, else null.
  kind: string | null;
  // Last ghost evaluation: top-left cell + combined reason code
  // ('ok' or a footprint/range code). Null when the cursor is off-map.
  ghost: { x: number; y: number; code: string } | null;
  // Road tool mode (R): mutually exclusive with structure build mode.
  roadMode: boolean;
  // Selected link indices for the next upgrade_links order.
  roadSel: number[];
  // Hovered link index under the cursor (road mode), -1 when none.
  roadHover: number;
  select(kind: string): void;
  cancel(): void;
  setGhost(ghost: BuildState['ghost']): void;
  enterRoad(): void;
  setRoadSel(links: number[]): void;
  toggleRoadLink(index: number): void;
  setRoadHover(index: number): void;
}

export const useBuildStore = create<BuildState>((set) => ({
  kind: null,
  ghost: null,
  roadMode: false,
  roadSel: [],
  roadHover: -1,
  select: (kind) => {
    set({ kind, roadMode: false, roadSel: [], roadHover: -1 });
  },
  cancel: () => {
    set({ kind: null, ghost: null, roadMode: false, roadSel: [], roadHover: -1 });
  },
  setGhost: (ghost) => {
    set({ ghost });
  },
  enterRoad: () => {
    set({ kind: null, ghost: null, roadMode: true, roadSel: [], roadHover: -1 });
  },
  setRoadSel: (links) => {
    set({ roadSel: links });
  },
  toggleRoadLink: (index) => {
    set((s) => ({
      roadSel: s.roadSel.includes(index)
        ? s.roadSel.filter((i) => i !== index)
        : [...s.roadSel, index].sort((a, b) => a - b),
    }));
  },
  setRoadHover: (index) => {
    set((s) => (s.roadHover === index ? s : { roadHover: index }));
  },
}));
