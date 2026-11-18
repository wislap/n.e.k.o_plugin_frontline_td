// Per-match client state reset (play-again): every client zustand store
// returns to its initial values and the mutable cursor trackers are
// cleared. Called before the worker restarts so stale selection, build
// mode, end-screen inputs and runtime stats cannot leak into the new
// match. Component-local state is reset by remounting with a fresh
// matchKey (app/main.tsx).
import { useBoxStore } from './box-store';
import { useBuildStore } from './build-store';
import { useCameraStore } from './camera-store';
import { cursorGround, cursorScreen } from './cursor';
import { useRuntimeStore } from './runtime-store';
import { useSelectionStore } from './selection-store';
import { useUiStore } from './ui-store';

export function resetClientState(): void {
  useSelectionStore.getState().reset();
  useBuildStore.getState().reset();
  useBoxStore.getState().reset();
  useUiStore.getState().reset();
  useCameraStore.getState().reset();
  useRuntimeStore.getState().reset();
  cursorGround.valid = false;
  cursorScreen.x = 0;
  cursorScreen.y = 0;
}
