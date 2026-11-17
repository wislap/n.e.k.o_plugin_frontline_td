// Producer tag data: structure content index (recipe lookup) plus the
// running progress counter in ticks (0 = idle).
import { defineComponent } from '../../../kernel/index';

export const Producer = defineComponent('frontline_td:production.producer', {
  kind: 'u16',
  progress: 'u32',
});
