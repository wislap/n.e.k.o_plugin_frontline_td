// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';
import { themeFromSearch, type ThemeId } from './theme';

export interface UiState {
  debugPanelOpen: boolean;
  // Visual theme (visual-slice): survives reset; set from ?theme= or the debug panel.
  theme: ThemeId;
  // Logistics overlay toggle (L); forced on while build/logistics mode is active.
  logisticsOverlay: boolean;
  keymapHelpOpen: boolean;
  minimapOpen: boolean;
  // Edge-outline render pass toggle (debug panel; default on for
  // mindustry-pixel, otherwise off — can be enabled on any theme).
  outline: boolean;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  toggleMinimap(): void;
  setTheme: (theme: ThemeId) => void;
  setOutline: (outline: boolean) => void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: false,
  theme: themeFromSearch(typeof location === 'undefined' ? '' : location.search),
  outline:
    themeFromSearch(typeof location === 'undefined' ? '' : location.search) === 'mindustry-pixel',
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
  setTheme: (theme) => {
    // Switching themes restores the theme's default outline state; the
    // checkbox can still override afterwards.
    set({ theme, outline: theme === 'mindustry-pixel' });
  },
  setOutline: (outline) => {
    set({ outline });
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
