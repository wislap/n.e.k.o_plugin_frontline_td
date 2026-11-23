// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';
export interface UiState {
  debugPanelOpen: boolean;
  // Logistics overlay toggle (L); forced on while build/logistics mode is active.
  logisticsOverlay: boolean;
  keymapHelpOpen: boolean;
  minimapOpen: boolean;
  // Grass/meadow scatter density multiplier (debug panel, themed themes).
  grassDensity: number;
  // Tactical 2D info treatment (弱化显示): dims terrain/structures while
  // the camera is in the tactical view so markers pop (debug panel).
  info2d: boolean;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  toggleMinimap(): void;
  setGrassDensity: (density: number) => void;
  setInfo2d: (on: boolean) => void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: false,
  grassDensity: 1,
  info2d: true,
  logisticsOverlay: false,
  // The key guide rail is collapsed into a small "K" chip by default
  // (visual-languages HUD structure); K expands it as an overlay.
  keymapHelpOpen: false,
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
  setGrassDensity: (grassDensity) => {
    set({ grassDensity });
  },
  setInfo2d: (info2d) => {
    set({ info2d });
  },
  reset: () => {
    set({
      debugPanelOpen: false,
      logisticsOverlay: false,
      keymapHelpOpen: false,
      minimapOpen: true,
    });
  },
}));
