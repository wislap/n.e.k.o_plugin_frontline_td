// Camera UI state (ADR 0028, ADR 0048, ADR 0060): mode, map-space center,
// zoom, horizontal yaw, manual pitch offset, perspective lock, and
// primary-mode-driven auto-tactical switching.
// Zoom means "spectate distance" in spectate and "visible ground height"
// in tactical.
import { create } from 'zustand';
import {
  clampPitchOffsetForDist,
  clampSpectateDist,
  clampTacticalHeight,
  effectiveSpectatePitchDeg,
  matchZoomForMode,
  nearestNorthYaw,
  SPECTATE_DEFAULT_DIST,
  spectateCursorGroundOffset,
  spectateFocusElevation,
} from './camera-math';
import type { PrimaryMode } from './interaction-store';

type CameraMode = 'spectate' | 'tactical';

interface ZoomAnchor {
  ndcX: number;
  ndcY: number;
  aspect: number;
  centerY: number;
  baseY?: number;
  localSmoothY?: number;
  planeY: number;
}

export interface CameraState {
  mode: CameraMode;
  center: { x: number; y: number };
  zoom: number;
  yaw: number;
  pitchOffsetDeg: number;
  // True when the current tactical view was entered automatically by
  // entering build or logistics mode (returning to command restores
  // spectate only in that case).
  autoSwitch: boolean;
  locked: boolean;
  setCenter(center: { x: number; y: number }): void;
  panBy(dx: number, dy: number): void;
  orbitBy(dYaw: number, dPitchDeg: number): void;
  resetOrientation(): void;
  setZoom(zoom: number): void;
  // Zoom while keeping a ground point (or spectate cursor ray) fixed.
  zoomToward(delta: number, ground: { x: number; y: number } | null, anchor?: ZoomAnchor): void;
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
  zoom: SPECTATE_DEFAULT_DIST,
  yaw: 0,
  pitchOffsetDeg: 0,
  autoSwitch: false,
  locked: false,
  setCenter: (center) => {
    set({ center });
  },
  panBy: (dx, dy) => {
    set((state) => ({ center: { x: state.center.x + dx, y: state.center.y + dy } }));
  },
  orbitBy: (dYaw, dPitchDeg) => {
    set((state) => ({
      yaw: state.yaw + dYaw,
      pitchOffsetDeg:
        state.mode === 'spectate'
          ? clampPitchOffsetForDist(state.zoom, state.pitchOffsetDeg + dPitchDeg)
          : state.pitchOffsetDeg,
    }));
  },
  resetOrientation: () => {
    set((state) => ({
      yaw: nearestNorthYaw(state.yaw),
      pitchOffsetDeg: 0,
    }));
  },
  setZoom: (zoom) => {
    set((state) => {
      if (state.mode === 'tactical') {
        return { zoom: clampTacticalHeight(zoom) };
      }
      const next = clampSpectateDist(zoom);
      return {
        zoom: next,
        pitchOffsetDeg: clampPitchOffsetForDist(next, state.pitchOffsetDeg),
      };
    });
  },
  zoomToward: (delta, ground, anchor) => {
    set((state) => {
      const oldZoom = state.zoom;
      if (state.mode === 'tactical') {
        const next = clampTacticalHeight(oldZoom * (1 + delta));
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
      }
      const next = clampSpectateDist(oldZoom * (1 + delta));
      const nextPitchOffset = clampPitchOffsetForDist(next, state.pitchOffsetDeg);
      if (next === oldZoom) {
        return { zoom: next, pitchOffsetDeg: nextPitchOffset };
      }
      if (anchor !== undefined) {
        const pOld = effectiveSpectatePitchDeg(oldZoom, state.pitchOffsetDeg);
        const pNext = effectiveSpectatePitchDeg(next, nextPitchOffset);
        const cOld =
          anchor.baseY !== undefined && anchor.localSmoothY !== undefined
            ? spectateFocusElevation(oldZoom, anchor.baseY, anchor.localSmoothY)
            : anchor.centerY;
        const cNext =
          anchor.baseY !== undefined && anchor.localSmoothY !== undefined
            ? spectateFocusElevation(next, anchor.baseY, anchor.localSmoothY)
            : anchor.centerY;
        const qOld = spectateCursorGroundOffset(
          anchor.ndcX,
          anchor.ndcY,
          anchor.aspect,
          oldZoom,
          state.yaw,
          pOld,
          cOld,
          anchor.planeY,
        );
        const qNext = spectateCursorGroundOffset(
          anchor.ndcX,
          anchor.ndcY,
          anchor.aspect,
          next,
          state.yaw,
          pNext,
          cNext,
          anchor.planeY,
        );
        if (qOld !== null && qNext !== null) {
          return {
            zoom: next,
            pitchOffsetDeg: nextPitchOffset,
            center: {
              x: state.center.x + qOld.x - qNext.x,
              y: state.center.y + qOld.y - qNext.y,
            },
          };
        }
      }
      if (ground === null) {
        return { zoom: next, pitchOffsetDeg: nextPitchOffset };
      }
      const k = 1 - next / oldZoom;
      return {
        zoom: next,
        pitchOffsetDeg: nextPitchOffset,
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
      // auto-switch and manual toggle share this conversion while preserving yaw.
      return {
        mode,
        zoom: matchZoomForMode(mode, state.zoom, state.pitchOffsetDeg),
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
      zoom: SPECTATE_DEFAULT_DIST,
      yaw: 0,
      pitchOffsetDeg: 0,
      autoSwitch: false,
      locked: false,
    });
  },
}));
