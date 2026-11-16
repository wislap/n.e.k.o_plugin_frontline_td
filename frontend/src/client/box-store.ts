// Drag-box overlay state (M2 C5): the on-screen selection rectangle, or
// null when no drag is in progress. Pure screen coordinates.
import { create } from 'zustand';

export interface BoxState {
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  setBox(box: BoxState['box']): void;
}

export const useBoxStore = create<BoxState>((set) => ({
  box: null,
  setBox: (box) => {
    set({ box });
  },
}));
