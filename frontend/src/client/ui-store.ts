// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';
import { PALETTE_IDS, type PaletteId } from '../render/theme/visual';

// Temporary owner A/B axes (deleted after palette selection): ?palette=
// and ?atm= seed the debug-panel toggles for screenshots.
const SEARCH = typeof location === 'undefined' ? '' : location.search;
const paletteFromSearch = (): PaletteId => {
  const p = new URLSearchParams(SEARCH).get('palette');
  return (PALETTE_IDS as readonly string[]).includes(p ?? '') ? (p as PaletteId) : 'mid';
};
const atmosphereFromSearch = (): number => {
  const raw = new URLSearchParams(SEARCH).get('atm');
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
};
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
  // Temporary debug axes (owner A/B): colour palette + atmosphere amount.
  palette: PaletteId;
  atmosphere: number;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  toggleMinimap(): void;
  setGrassDensity: (density: number) => void;
  setInfo2d: (on: boolean) => void;
  setPalette: (palette: PaletteId) => void;
  setAtmosphere: (atmosphere: number) => void;
  reset(): void;
}

export const useUiStore = create<UiState>((set) => ({
  debugPanelOpen: false,
  grassDensity: 1,
  info2d: true,
  palette: paletteFromSearch(),
  atmosphere: atmosphereFromSearch(),
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
  setPalette: (palette) => {
    set({ palette });
  },
  setAtmosphere: (atmosphere) => {
    set({ atmosphere });
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
