// Movement command + intent descriptors: shared by the sim command
// handler and the client (render/input may import this file but never
// sim/). The intent carries the same payload as the command and is
// resolved by the movement module at the start of the movement phase.
import { defineCommand, defineEvent, defineIntent, s } from '../../core/index';

export const MoveCommand = defineCommand(
  'frontline_td:movement.move',
  s.object({
    units: s.array(s.handle(), { maxLength: 1024 }),
    x: s.int({ min: 0 }),
    y: s.int({ min: 0 }),
  }),
);

// Sim-internal order channel (ADR 0008): squads/AI emit these; the
// resolver validates handle liveness and Mover but not faction (the
// emitter's responsibility). Shares the command's id space on purpose:
// a command is the player-facing form of the same order.
export const MoveIntent = defineIntent<{
  units: number[];
  x: number;
  y: number;
  slots?: { x: number; y: number }[];
}>('frontline_td:movement.move');
export const StopIntent = defineIntent<{ units: number[] }>('frontline_td:movement.stop');
// Transient scalar squad cruise speed cap (ADR 0054 / ADR 0057).
export const FormationGuideIntent = defineIntent<{
  units: number[];
  maxSpeeds?: number[];
  active: boolean;
}>('frontline_td:movement.formation_guide');

// Emitted by the MoveCommand handler with the handles it applied (player
// override — squads drop these members). Intents do not emit this.
export const MoveOrdered = defineEvent<{ units: number[] }>('frontline_td:movement.ordered', 'all');
