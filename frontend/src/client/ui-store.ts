// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';

export interface UiState {
  debugPanelOpen: boolean;
  // Logistics overlay toggle (L); forced on while build mode is active.
  logisticsOverlay: boolean;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: true,
  logisticsOverlay: false,
  toggleDebugPanel: () => {
    set((state) => ({ debugPanelOpen: !state.debugPanelOpen }));
  },
  toggleLogisticsOverlay: () => {
    set((state) => ({ logisticsOverlay: !state.logisticsOverlay }));
  },
  reset: () => {
    set({ debugPanelOpen: true, logisticsOverlay: false });
  },
}));
