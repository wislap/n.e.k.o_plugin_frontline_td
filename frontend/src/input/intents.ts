// Runtime intents produced by input handling and routed by app/dispatch
// (ADR: input → intent → command).
export type Intent =
  | { kind: 'runtime.toggle_pause' }
  // Steps the speed index by delta over SPEED_STEPS (M4: -/= keys).
  | { kind: 'runtime.speed_step'; delta: number }
  | { kind: 'dev.toggle_panel' }
  | { kind: 'camera.toggle_mode' }
  | { kind: 'camera.pan_px'; dx: number; dy: number }
  | { kind: 'camera.zoom'; delta: number; x: number; y: number }
  | { kind: 'select.click'; x: number; y: number; additive: boolean }
  | { kind: 'select.box'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'command.move_to'; x: number; y: number; guard: boolean }
  // Digit hotkeys (M4): Ctrl+digit creates a squad from the selection,
  // bare digit selects the bound squad (double-press centres the camera).
  | { kind: 'squad.digit'; digit: number; ctrl: boolean }
  // Cursor rest position in screen pixels (build ghost tracking).
  | { kind: 'cursor.move'; x: number; y: number }
  | { kind: 'build.select'; kindId: string }
  | { kind: 'build.cancel' }
  // Screen-pixel place request; the canvas dispatch converts to cells.
  | { kind: 'build.place'; x: number; y: number; blueprint: boolean }
  | { kind: 'selection.activate' }
  | { kind: 'selection.cancel' }
  | { kind: 'overlay.toggle_logistics' }
  // Road tool (E3): R toggles the mode, Enter confirms the selection,
  // road.click comes from the pointer while road mode is active.
  | { kind: 'road.toggle' }
  | { kind: 'road.confirm' }
  | { kind: 'road.click'; x: number; y: number; additive: boolean };
