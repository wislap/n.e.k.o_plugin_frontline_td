// Combat protocol (ADR 0011): damage intents are emitted by the fire
// system and read back by combat's own resolve system; events feed the
// client (shot tracers) and the cleanup-phase death readers.
import { defineEvent, defineIntent } from '../../core/index';

// target = entity handle, amount = milli damage.
export type DamagePayload = { target: number; amount: number };
export const DamageIntent = defineIntent<DamagePayload>('frontline_td:combat.damage');

export type ShotPayload = {
  from: number;
  to: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};
export const CombatShot = defineEvent<ShotPayload>('frontline_td:combat.shot', 'all');

// Emitted once per entity when its hp drops to 0; cleanup-phase readers
// (movement, construction) release per-entity resources before combat's
// own despawn runs.
export type DiedPayload = { handle: number; faction: number };
export const CombatDied = defineEvent<DiedPayload>('frontline_td:combat.died', 'all');

// Inspector section id for combat entities.
export const COMBAT_INSPECTOR_ID = 'frontline_td:combat';

// Inspector section payload emitted by frontline_td:combat.
export type CombatInspection = {
  hp: number;
  max: number;
  readyIn?: number;
  target?: number;
  costCargo?: number;
  costStock?: number;
};
