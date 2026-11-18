// Build-mode UI state (M3 D + E3): the selected structure content id, or
// null; plus the road-upgrade tool mode with its selected links. Links
// are stored as normalized node-handle pairs (RoadLinkKey) because link
// indices drift whenever the network channel rebuilds; renderers resolve
// them back to indices per frame. The ghost's last evaluated placement
// code is mirrored here (updated by the preview layer only when it
// changes) so the HUD can localize it.
import { create } from 'zustand';
import type { RoadLinkKey } from '../features/logistics/protocol';

export interface BuildState {
  // Structure content id while build mode is active, else null.
  kind: string | null;
  // Last ghost evaluation: top-left cell + combined reason code
  // ('ok' or a footprint/range code). Null when the cursor is off-map.
  ghost: { x: number; y: number; code: string } | null;
  // Road tool mode (R): mutually exclusive with structure build mode.
  roadMode: boolean;
  // Selected links for the next upgrade_links order (handle pairs).
  roadSel: RoadLinkKey[];
  // Hovered link index under the cursor (road mode), -1 when none.
  roadHover: number;
  select(kind: string): void;
  cancel(): void;
  setGhost(ghost: BuildState['ghost']): void;
  enterRoad(): void;
  setRoadSel(links: RoadLinkKey[]): void;
  toggleRoadLink(key: RoadLinkKey): void;
  setRoadHover(index: number): void;
  reset(): void;
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
  toggleRoadLink: (key) => {
    set((s) => ({
      roadSel: s.roadSel.some((k) => k.a === key.a && k.b === key.b)
        ? s.roadSel.filter((k) => !(k.a === key.a && k.b === key.b))
        : [...s.roadSel, key].sort((x, y) => x.a - y.a || x.b - y.b),
    }));
  },
  setRoadHover: (index) => {
    set((s) => (s.roadHover === index ? s : { roadHover: index }));
  },
  reset: () => {
    set({ kind: null, ghost: null, roadMode: false, roadSel: [], roadHover: -1 });
  },
}));
