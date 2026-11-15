import { defineComponent } from './components';

// Kernel contract components (ADR 0019/0021). No writer is claimed in M1;
// Faction is set at spawn (creation is a kernel op, not a write).
export const Faction = defineComponent('frontline_td:faction', { id: 'u16' });
export const InWorld = defineComponent('frontline_td:in_world', {});
export const ContainedIn = defineComponent('frontline_td:contained_in', {
  container: 'handle',
});
