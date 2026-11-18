// Capture-owned component, added to ruins via construction's injected
// `ruinParts` (wired in app). `kind`, `x` and `y` mirror the ruin's
// Structure fields at spawn time so the capture module needs no import
// of construction internals — construction reads the event emitted here.
import { defineComponent } from '../../../kernel/index';

export const Capture = defineComponent('frontline_td:capture', {
  // Faction currently holding progress; 0 = nobody.
  owner: 'u16',
  // Accumulated milli-log units toward `total` (= ticks * lnMilli(e+1)).
  progress: 'u32',
  done: 'u8',
  // Mirrored ruin identity (Structure content index + footprint
  // top-left) for the completion event payload.
  kind: 'u16',
  x: 'u16',
  y: 'u16',
  // Snapshot convenience: faction winning this tick's tug and the
  // top-rate tie flag (set by the progress system).
  leader: 'u16',
  contested: 'u8',
});
