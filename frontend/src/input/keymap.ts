import type { Intent } from './intents';

// Default key bindings, keyed by KeyboardEvent.code (layout-independent).
export const DEFAULT_KEYMAP: Readonly<Record<string, Intent>> = {
  Space: { kind: 'runtime.toggle_pause' },
  Minus: { kind: 'runtime.speed_step', delta: -1 },
  Equal: { kind: 'runtime.speed_step', delta: 1 },
  Digit1: { kind: 'squad.digit', digit: 1, ctrl: false },
  Digit2: { kind: 'squad.digit', digit: 2, ctrl: false },
  Digit3: { kind: 'squad.digit', digit: 3, ctrl: false },
  Digit4: { kind: 'squad.digit', digit: 4, ctrl: false },
  Digit5: { kind: 'squad.digit', digit: 5, ctrl: false },
  Digit6: { kind: 'squad.digit', digit: 6, ctrl: false },
  Digit7: { kind: 'squad.digit', digit: 7, ctrl: false },
  Digit8: { kind: 'squad.digit', digit: 8, ctrl: false },
  Digit9: { kind: 'squad.digit', digit: 9, ctrl: false },
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
