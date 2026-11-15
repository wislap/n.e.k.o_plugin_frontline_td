// Runtime intents produced by input handling and routed by app/dispatch
// (ADR: input → intent → command).
export type Intent =
  | { kind: 'runtime.toggle_pause' }
  | { kind: 'runtime.set_speed'; index: number }
  | { kind: 'dev.toggle_panel' };
