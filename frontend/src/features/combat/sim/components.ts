// Combat components: Health (milli hp), Targetable (hit radius for range
// checks) and Weapon (an instant-delivery emitter; target stores the last
// acquired target handle, 0 = none, costCargo 0xFFFF = free).
import { defineComponent } from '../../../kernel/index';

export const Health = defineComponent('frontline_td:combat.health', {
  hp: 'i32',
  max: 'i32',
});

export const Targetable = defineComponent('frontline_td:combat.targetable', {
  radius: 'f64',
});

export const FREE_COST_CARGO = 0xffff;

export const Weapon = defineComponent('frontline_td:combat.weapon', {
  range: 'f64',
  damage: 'i32',
  cooldown: 'u32',
  readyAt: 'u32',
  costCargo: 'u16',
  costAmount: 'i32',
  // Acquired target entity handle; 0 = none.
  target: 'f64',
});
