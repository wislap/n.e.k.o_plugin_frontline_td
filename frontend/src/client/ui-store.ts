// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';

export interface UiState {
  debugPanelOpen: boolean;
  // Logistics overlay toggle (L); forced on while build/logistics mode is active.
  logisticsOverlay: boolean;
  keymapHelpOpen: boolean;
  minimapOpen: boolean;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  toggleMinimap(): void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: false,
  logisticsOverlay: false,
  keymapHelpOpen: true,
  minimapOpen: true,
  toggleDebugPanel: () => {
    set((state) => ({ debugPanelOpen: !state.debugPanelOpen }));
  },
  toggleLogisticsOverlay: () => {
    set((state) => ({ logisticsOverlay: !state.logisticsOverlay }));
  },
  toggleKeymapHelp: () => {
    set((state) => ({ keymapHelpOpen: !state.keymapHelpOpen }));
  },
  toggleMinimap: () => {
    set((state) => ({ minimapOpen: !state.minimapOpen }));
  },
  reset: () => {
    set({
      debugPanelOpen: false,
      logisticsOverlay: false,
      keymapHelpOpen: true,
      minimapOpen: true,
    });
  },
}));
