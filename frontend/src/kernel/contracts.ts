import { defineComponent } from './components';

// Kernel contract components (ADR 0019/0021). No writer is claimed in M1;
// Faction is set at spawn (creation is a kernel op, not a write).
export const Faction = defineComponent('frontline_td:faction', { id: 'u16' });
export const InWorld = defineComponent('frontline_td:in_world', {});
// Set by construction while a structure is being built (claimed there).
// Operational systems (logistics demand, production, weapons) exclude it.
export const UnderConstruction = defineComponent('frontline_td:under_construction', {});
export const OPERATIONAL_EXCLUDE = [UnderConstruction] as const;
