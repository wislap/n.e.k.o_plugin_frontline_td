// UI-only state kept in zustand (never per-tick entity state, ADR 0004).
import { create } from 'zustand';

// Debug-panel "Render cost" toggles: production defaults are all on so
// the owner can measure each pass's cost on their GPU without a rebuild.
interface RenderCostToggles {
  n8ao: boolean;
  bloom: boolean;
  smaa: boolean;
  shadows: boolean;
  scatter: boolean;
  // Device-pixel-ratio cap: 0 = native, otherwise a hard maximum.
  dprCap: number;
}

// Rolling renderer readout fed by the Canvas-side perf probe. While the
// debug panel is open gl.info.autoReset is off and the counters reflect
// one whole rendered frame.
interface RenderStats {
  frameMs: number;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  programs: number;
  geometries: number;
  textures: number;
}

// GPU timer readout (EXT_disjoint_timer_query_webgl2) plus static
// context info, published by the dev GPU instrumentation.
interface GpuPassTiming {
  label: string;
  ms: number;
}
interface GpuStats {
  available: boolean;
  renderer: string;
  bufferWidth: number;
  bufferHeight: number;
  dpr: number;
  totalMs: number;
  labels: GpuPassTiming[];
}

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
  // Debug panel "Render cost" group (dev only).
  renderCost: RenderCostToggles;
  renderStats: RenderStats | null;
  gpuStats: GpuStats | null;
  // Debug panel scene-layer visibility toggles (empty = all visible).
  hiddenSceneLayers: ReadonlySet<string>;
  toggleDebugPanel(): void;
  toggleLogisticsOverlay(): void;
  toggleKeymapHelp(): void;
  toggleMinimap(): void;
  setGrassDensity: (density: number) => void;
  setInfo2d: (on: boolean) => void;
  setRenderCost: (patch: Partial<RenderCostToggles>) => void;
  setRenderStats: (stats: RenderStats | null) => void;
  setGpuStats: (stats: GpuStats | null) => void;
  setSceneLayerHidden: (id: string, hidden: boolean) => void;
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
  renderCost: { n8ao: true, bloom: true, smaa: true, shadows: true, scatter: true, dprCap: 0 },
  renderStats: null,
  gpuStats: null,
  hiddenSceneLayers: new Set<string>(),
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
  setRenderCost: (patch) => {
    set((state) => ({ renderCost: { ...state.renderCost, ...patch } }));
  },
  setRenderStats: (renderStats) => {
    set({ renderStats });
  },
  setGpuStats: (gpuStats) => {
    set({ gpuStats });
  },
  setSceneLayerHidden: (id, hidden) => {
    set((state) => {
      const next = new Set(state.hiddenSceneLayers);
      if (hidden) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return { hiddenSceneLayers: next };
    });
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
