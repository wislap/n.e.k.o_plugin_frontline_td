// Road-tool selection state (ADR 0062 step 4b): the road link selection
// and hover index used to live on the interaction store's tool-transient
// block; they moved here with the road tool itself. The store clears
// whenever the interaction tool changes (every setMode / enter* /
// exitTool / reset call produces a fresh tool object), mirroring the old
// toolTransientClear() behaviour, and on session reset.
import { create } from 'zustand';
import { useInteractionStore } from '../../../client/interaction-store';
import { registerSessionReset } from '../../../client/session';
import type { RoadLinkKey } from '../protocol';

export interface RoadToolState {
  roadSel: RoadLinkKey[];
  roadHover: number;
  setRoadSel(links: RoadLinkKey[]): void;
  toggleRoadLink(key: RoadLinkKey): void;
  setRoadHover(index: number): void;
  reset(): void;
}

export const useRoadToolStore = create<RoadToolState>((set) => ({
  roadSel: [],
  roadHover: -1,
  setRoadSel: (roadSel) => {
    set({ roadSel });
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
    set({ roadSel: [], roadHover: -1 });
  },
}));

useInteractionStore.subscribe((state, prev) => {
  if (state.tool !== prev.tool) {
    useRoadToolStore.getState().reset();
  }
});

registerSessionReset(() => {
  useRoadToolStore.getState().reset();
});
