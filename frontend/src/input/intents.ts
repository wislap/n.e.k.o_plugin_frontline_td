// Runtime intents produced by input handling and routed by app/dispatch
// (ADR: input → intent → command).
export type Intent =
  | { kind: 'runtime.toggle_pause' }
  | { kind: 'runtime.set_speed'; index: number }
  | { kind: 'dev.toggle_panel' }
  | { kind: 'camera.toggle_mode' }
  | { kind: 'camera.pan_px'; dx: number; dy: number }
  | { kind: 'camera.zoom'; delta: number; x: number; y: number }
  | { kind: 'select.click'; x: number; y: number; additive: boolean }
  | { kind: 'select.box'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'command.move_to'; x: number; y: number };
