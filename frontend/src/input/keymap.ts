import type { Intent } from './intents';

// Default key bindings, keyed by KeyboardEvent.code (layout-independent).
export const DEFAULT_KEYMAP: Readonly<Record<string, Intent>> = {
  Space: { kind: 'runtime.toggle_pause' },
  Digit1: { kind: 'runtime.set_speed', index: 1 },
  Digit2: { kind: 'runtime.set_speed', index: 2 },
  Digit3: { kind: 'runtime.set_speed', index: 3 },
  Backquote: { kind: 'dev.toggle_panel' },
};
