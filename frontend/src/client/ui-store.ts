// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';

export interface UiState {
  debugPanelOpen: boolean;
  // Logistics overlay toggle (L); forced on while build/logistics mode is active.
  logisticsOverlay: boolean;
  keymapHelpOpen: boolean;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  closeKeymapHelp(): void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: true,
  logisticsOverlay: false,
  keymapHelpOpen: false,
  toggleDebugPanel: () => {
    set((state) => ({ debugPanelOpen: !state.debugPanelOpen }));
  },
  toggleLogisticsOverlay: () => {
    set((state) => ({ logisticsOverlay: !state.logisticsOverlay }));
  },
  toggleKeymapHelp: () => {
    set((state) => ({ keymapHelpOpen: !state.keymapHelpOpen }));
  },
  closeKeymapHelp: () => {
    set((state) => (state.keymapHelpOpen ? { keymapHelpOpen: false } : state));
  },
  reset: () => {
    set({ debugPanelOpen: true, logisticsOverlay: false, keymapHelpOpen: false });
  },
}));
