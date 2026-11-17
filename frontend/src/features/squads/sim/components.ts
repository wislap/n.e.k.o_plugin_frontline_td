// SquadMember: squads-owned back-reference from a unit entity to its
// squad id (0 = none). Written only by the squads module.
import { defineComponent } from '../../../kernel/index';

export const SquadMember = defineComponent('frontline_td:squads.member', {
  squad: 'u16',
});
