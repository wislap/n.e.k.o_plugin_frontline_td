// Camera UI state (ADR 0028, ADR 0048): mode, map-space center, zoom,
// perspective lock, and primary-mode-driven auto-tactical switching.
// Zoom means "spectate distance" in spectate and "visible ground height"
// in tactical.
import { create } from 'zustand';
import { clampSpectateDist, clampTacticalHeight, matchZoomForMode } from './camera-math';
import type { PrimaryMode } from './interaction-store';

type CameraMode = 'spectate' | 'tactical';

export interface CameraState {
  mode: CameraMode;
  center: { x: number; y: number };
  zoom: number;
  // True when the current tactical view was entered automatically by
  // entering build or logistics mode (returning to command restores
  // spectate only in that case).
  autoSwitch: boolean;
  locked: boolean;
  setCenter(center: { x: number; y: number }): void;
  panBy(dx: number, dy: number): void;
  setZoom(zoom: number): void;
  // Zoom while keeping a ground point fixed (cursor-anchored zoom).
  zoomToward(delta: number, ground: { x: number; y: number } | null): void;
  toggleMode(): void;
  setMode(mode: CameraMode, auto: boolean): void;
  toggleLocked(): void;
  setLocked(locked: boolean): void;
  syncForPrimaryMode(mode: PrimaryMode): void;
  reset(): void;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  mode: 'spectate',
  center: { x: 0, y: 0 },
  zoom: 30,
  autoSwitch: false,
  locked: false,
  setCenter: (center) => {
    set({ center });
  },
  panBy: (dx, dy) => {
    set((state) => ({ center: { x: state.center.x + dx, y: state.center.y + dy } }));
  },
  setZoom: (zoom) => {
    set((state) => ({
      zoom: state.mode === 'tactical' ? clampTacticalHeight(zoom) : clampSpectateDist(zoom),
    }));
  },
  zoomToward: (delta, ground) => {
    set((state) => {
      const oldZoom = state.zoom;
      const next =
        state.mode === 'tactical'
          ? clampTacticalHeight(oldZoom * (1 + delta))
          : clampSpectateDist(oldZoom * (1 + delta));
      if (ground === null || next === oldZoom) {
        return { zoom: next };
      }
      const k = 1 - next / oldZoom;
      return {
        zoom: next,
        center: {
          x: state.center.x + (ground.x - state.center.x) * k,
          y: state.center.y + (ground.y - state.center.y) * k,
        },
      };
    });
  },
  toggleMode: () => {
    get().setMode(get().mode === 'spectate' ? 'tactical' : 'spectate', false);
  },
  setMode: (mode, auto) => {
    set((state) => {
      if (mode === state.mode) {
        return { autoSwitch: auto };
      }
      // Keep the viewed ground extent across the swap (no visible jump);
      // auto-switch and manual toggle share this conversion.
      return {
        mode,
        zoom: matchZoomForMode(mode, state.zoom),
        autoSwitch: auto,
      };
    });
  },
  toggleLocked: () => {
    set((state) => ({ locked: !state.locked }));
  },
  setLocked: (locked) => {
    set({ locked });
  },
  syncForPrimaryMode: (mode) => {
    const state = get();
    if (state.locked) {
      return;
    }
    if (mode === 'build' || mode === 'logistics') {
      if (state.mode === 'spectate') {
        get().setMode('tactical', true);
      }
      return;
    }
    if (state.mode === 'tactical' && state.autoSwitch) {
      get().setMode('spectate', false);
    }
  },
  reset: () => {
    set({
      mode: 'spectate',
      center: { x: 0, y: 0 },
      zoom: 30,
      autoSwitch: false,
      locked: false,
    });
  },
}));
