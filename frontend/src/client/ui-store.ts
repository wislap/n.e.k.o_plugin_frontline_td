// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';
import { themeFromSearch, type ThemeId } from './theme';
import { defaultSkinFor, uiSkinFromSearch, type UiSkinId } from './ui-skin';

const INITIAL_THEME = themeFromSearch(typeof location === 'undefined' ? '' : location.search);
const INITIAL_SKIN =
  uiSkinFromSearch(typeof location === 'undefined' ? '' : location.search) ??
  defaultSkinFor(INITIAL_THEME);

export interface UiState {
  debugPanelOpen: boolean;
  // Visual theme (visual-slice): survives reset; set from ?theme= or the debug panel.
  theme: ThemeId;
  // HUD skin (visual-languages): independent axis; each theme picks a
  // default on switch, ?ui= or the debug panel overrides.
  uiSkin: UiSkinId;
  // Logistics overlay toggle (L); forced on while build/logistics mode is active.
  logisticsOverlay: boolean;
  keymapHelpOpen: boolean;
  minimapOpen: boolean;
  // Edge-outline render pass toggle (debug panel; off by default on every
  // theme — the geometry outline siblings can be enabled on any theme).
  outline: boolean;
  // Grass/meadow scatter density multiplier (debug panel, themed themes).
  grassDensity: number;
  // Tactical 2D info treatment (弱化显示): dims terrain/structures while
  // the camera is in the tactical view so markers pop (debug panel).
  info2d: boolean;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  toggleMinimap(): void;
  setTheme: (theme: ThemeId) => void;
  setUiSkin: (skin: UiSkinId) => void;
  setOutline: (outline: boolean) => void;
  setGrassDensity: (density: number) => void;
  setInfo2d: (on: boolean) => void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: false,
  theme: INITIAL_THEME,
  uiSkin: INITIAL_SKIN,
  outline: false,
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
  setTheme: (theme) => {
    // Switching themes restores the theme's default skin + outline state;
    // the dropdowns/checkboxes can still override afterwards.
    set({ theme, uiSkin: defaultSkinFor(theme), outline: false });
  },
  setUiSkin: (uiSkin) => {
    set({ uiSkin });
  },
  setOutline: (outline) => {
    set({ outline });
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
