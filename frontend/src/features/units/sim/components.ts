// Units-owned component: the unit-kind content index (ADR 0022). Mover and
// Position live in features/movement.
import { defineComponent } from '../../../kernel/index';

export const UnitKind = defineComponent('frontline_td:units.kind', { kind: 'u16' });
