import type { Intent } from './intents';

// Default key bindings, keyed by KeyboardEvent.code (layout-independent).
export const DEFAULT_KEYMAP: Readonly<Record<string, Intent>> = {
  Space: { kind: 'runtime.toggle_pause' },
  Digit1: { kind: 'runtime.set_speed', index: 1 },
  Digit2: { kind: 'runtime.set_speed', index: 2 },
  Digit3: { kind: 'runtime.set_speed', index: 3 },
  Backquote: { kind: 'dev.toggle_panel' },
  KeyV: { kind: 'camera.toggle_mode' },
  KeyG: { kind: 'selection.activate' },
  KeyX: { kind: 'selection.cancel' },
  Delete: { kind: 'selection.cancel' },
  KeyL: { kind: 'overlay.toggle_logistics' },
  KeyR: { kind: 'road.toggle' },
  Enter: { kind: 'road.confirm' },
  Escape: { kind: 'build.cancel' },
};
