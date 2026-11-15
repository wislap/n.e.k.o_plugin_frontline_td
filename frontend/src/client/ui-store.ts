// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';

export interface UiState {
  debugPanelOpen: boolean;
  toggleDebugPanel(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: true,
  toggleDebugPanel: () => {
    set((state) => ({ debugPanelOpen: !state.debugPanelOpen }));
  },
}));
