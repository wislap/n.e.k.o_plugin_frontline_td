// Per-match client state reset (play-again): every client zustand store
// returns to its initial values, the encapsulated cursor trackers are
// cleared, and registered match-local callbacks are invoked before the
// worker restarts.
import { useBoxStore } from './box-store';
import { useCameraStore } from './camera-store';
import { cursorState } from './cursor';
import { useInspectorStore } from './inspector-store';
import { useInteractionStore } from './interaction-store';
import { useRuntimeStore } from './runtime-store';
import { useSelectionStore } from './selection-store';
import { useUiStore } from './ui-store';

const resetCallbacks = new Set<() => void>();

export function registerSessionReset(fn: () => void): void {
  resetCallbacks.add(fn);
}

export function resetClientState(): void {
  useSelectionStore.getState().reset();
  useInspectorStore.getState().reset();
  useInteractionStore.getState().reset();
  useBoxStore.getState().reset();
  useUiStore.getState().reset();
  useCameraStore.getState().reset();
  useRuntimeStore.getState().reset();
  cursorState.reset();
  for (const fn of resetCallbacks) {
    fn();
  }
}
