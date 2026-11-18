import { defineComponent } from '../../../kernel/index';

// Sight source stamped into the owner's vision layer. Units move, so
// their centre comes from Position at recompute time; structures carry
// no Position, so the parts factory bakes the footprint centre into
// x/y here (unused on units).
export const Vision = defineComponent('frontline_td:vision', {
  radius: 'u16',
  x: 'f64',
  y: 'f64',
});
