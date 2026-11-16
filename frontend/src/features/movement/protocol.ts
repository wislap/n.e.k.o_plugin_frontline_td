// Movement command descriptor: shared by the sim command handler and the
// client (render/input may import this file but never sim/).
import { defineCommand, s } from '../../core/index';

export const MoveCommand = defineCommand(
  'frontline_td:movement.move',
  s.object({
    units: s.array(s.handle(), { maxLength: 1024 }),
    x: s.int({ min: 0 }),
    y: s.int({ min: 0 }),
  }),
);
