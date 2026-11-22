// Mode-layered key bindings, keyed by KeyboardEvent.code (layout-independent)
// plus declarative help metadata for the `?` overlay (ADR 0048).
import type { PrimaryMode } from '../client/interaction-store';
import type { Intent } from './intents';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function squadDigitMap(): Readonly<Record<string, Intent>> {
  const map: Record<string, Intent> = {};
  for (const digit of DIGITS) {
    map[`Digit${digit}`] = { kind: 'squad.digit', digit, ctrl: false };
  }
  return map;
}

function buildCategoryDigitMap(): Readonly<Record<string, Intent>> {
  const map: Record<string, Intent> = {};
  for (const slot of DIGITS) {
    map[`Digit${slot}`] = { kind: 'build.category_digit', slot };
  }
  return map;
}

export const GLOBAL_KEYMAP: Readonly<Record<string, Intent>> = {
  Space: { kind: 'runtime.toggle_pause' },
  Minus: { kind: 'runtime.speed_step', delta: -1 },
  Equal: { kind: 'runtime.speed_step', delta: 1 },
  Tab: { kind: 'camera.toggle_mode' },
  KeyN: { kind: 'camera.reset_orientation' },
  Home: { kind: 'camera.reset_orientation' },
  F1: { kind: 'mode.select', mode: 'command' },
  F2: { kind: 'mode.select', mode: 'build' },
  F3: { kind: 'mode.select', mode: 'logistics' },
  KeyL: { kind: 'overlay.toggle_logistics' },
  KeyK: { kind: 'ui.toggle_keymap_help' },
  Backquote: { kind: 'dev.toggle_panel' },
  Escape: { kind: 'escape' },
};

export const MODE_KEYMAPS: Readonly<Record<PrimaryMode, Readonly<Record<string, Intent>>>> = {
  command: {
    ...squadDigitMap(),
  },
  build: {
    // 1-9 in build mode are explicitly reserved for build categories and
    // never select squads.
    ...buildCategoryDigitMap(),
    KeyG: { kind: 'selection.activate' },
    KeyC: { kind: 'demolish.press' },
    Delete: { kind: 'demolish.press' },
  },
  logistics: {
    KeyR: { kind: 'road.toggle' },
    Enter: { kind: 'road.confirm' },
  },
};

interface KeybindingEntry {
  readonly keys: string;
  readonly descKey: string;
}

export interface KeybindingGroup {
  readonly titleKey: string;
  readonly mode?: PrimaryMode;
  readonly entries: readonly KeybindingEntry[];
}

export const KEYBINDING_GROUPS: readonly KeybindingGroup[] = [
  {
    titleKey: 'help.group.global',
    entries: [
      { keys: 'Space', descKey: 'help.key.pause' },
      { keys: '- / =', descKey: 'help.key.speed' },
      { keys: 'Tab', descKey: 'help.key.camera' },
      { keys: 'WASD / Arrows', descKey: 'help.key.pan' },
      { keys: 'Q / E', descKey: 'help.key.rotate_camera' },
      { keys: 'MMB / Alt+Drag', descKey: 'help.key.orbit_camera' },
      { keys: 'Shift+MMB', descKey: 'help.key.grab_pan' },
      { keys: 'N / Home', descKey: 'help.key.reset_north' },
      { keys: 'F1 / F2 / F3', descKey: 'help.key.modes' },
      { keys: 'L', descKey: 'help.key.logistics_overlay' },
      { keys: '`', descKey: 'help.key.debug' },
      { keys: 'Esc', descKey: 'help.key.escape' },
      { keys: 'K', descKey: 'help.key.help' },
    ],
  },
  {
    titleKey: 'help.group.command',
    mode: 'command',
    entries: [
      { keys: '1-9', descKey: 'help.key.squad_select' },
      { keys: 'Ctrl+1-9', descKey: 'help.key.squad_create' },
      { keys: 'Right-click', descKey: 'help.key.move' },
      { keys: 'Ctrl+Right-click', descKey: 'help.key.guard' },
    ],
  },
  {
    titleKey: 'help.group.build',
    mode: 'build',
    entries: [
      { keys: '1-9', descKey: 'help.key.build_category' },
      { keys: 'Shift+Click', descKey: 'help.key.place_blueprint' },
      { keys: 'G', descKey: 'help.key.activate' },
      { keys: 'C / Del', descKey: 'help.key.demolish' },
      { keys: 'Right-click', descKey: 'help.key.exit_tool' },
    ],
  },
  {
    titleKey: 'help.group.logistics',
    mode: 'logistics',
    entries: [
      { keys: 'R', descKey: 'help.key.road_tool' },
      { keys: 'Shift+Click', descKey: 'help.key.road_toggle_link' },
      { keys: 'Enter', descKey: 'help.key.road_confirm' },
      { keys: 'Right-click', descKey: 'help.key.exit_tool' },
    ],
  },
];
