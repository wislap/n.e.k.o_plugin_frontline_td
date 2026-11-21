// Runtime intents produced by input handling and routed by app/dispatch
// (ADR 0048: input -> intent -> command).
import type { PrimaryMode } from '../client/interaction-store';

export type Intent =
  | { kind: 'runtime.toggle_pause' }
  // Steps the speed index by delta over SPEED_STEPS (M4: -/= keys).
  | { kind: 'runtime.speed_step'; delta: number }
  | { kind: 'dev.toggle_panel' }
  | { kind: 'camera.toggle_mode' }
  | { kind: 'camera.toggle_lock' }
  | { kind: 'camera.pan_px'; dx: number; dy: number }
  | { kind: 'camera.zoom'; delta: number; x: number; y: number }
  | { kind: 'mode.select'; mode: PrimaryMode }
  | { kind: 'tool.exit' }
  | { kind: 'escape' }
  | { kind: 'ui.toggle_keymap_help' }
  | { kind: 'overlay.toggle_logistics' }
  | { kind: 'inspector.unpin' }
  // Digit hotkeys in command mode: Ctrl+digit creates a squad from the
  // selection, bare digit selects the bound squad (double-press centres).
  | { kind: 'squad.digit'; digit: number; ctrl: boolean }
  // Digit hotkeys in build mode: selects the structure category slot (1..9).
  | { kind: 'build.category_digit'; slot: number }
  | { kind: 'build.select'; kindId: string }
  // Screen-pixel place request; the canvas dispatch converts to cells.
  | { kind: 'build.place'; x: number; y: number; blueprint: boolean }
  | { kind: 'demolish.press' }
  | { kind: 'demolish.confirm' }
  | { kind: 'demolish.click'; x: number; y: number }
  | { kind: 'selection.activate' }
  // Road tool: R toggles the mode, Enter confirms the selection,
  // road.click comes from the pointer while road tool is active.
  | { kind: 'road.toggle' }
  | { kind: 'road.confirm' }
  | { kind: 'road.click'; x: number; y: number; additive: boolean }
  // Cursor rest position in screen pixels (hover inspection & build ghost).
  | { kind: 'cursor.move'; x: number; y: number }
  | { kind: 'select.click'; x: number; y: number; additive: boolean }
  | { kind: 'select.box'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'command.move_to'; x: number; y: number; guard: boolean };
