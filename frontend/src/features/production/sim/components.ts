// Producer tag data: structure content index (recipe lookup), the
// running progress counter in ticks (0 = idle) and the unitOutput
// cycle index (serialized producer state, 0 without unitOutput).
import { defineComponent } from '../../../kernel/index';

export const Producer = defineComponent('frontline_td:production.producer', {
  kind: 'u16',
  progress: 'u32',
  cycle: 'u8',
});
