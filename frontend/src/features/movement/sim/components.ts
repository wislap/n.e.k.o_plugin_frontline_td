// Movement-owned components (ADR 0010/0020). Positions are f64 cell units;
// cell (x,y) centre is x+0.5, y+0.5.
import { defineComponent } from '../../../kernel/index';

export const Position = defineComponent('frontline_td:movement.position', {
  x: 'f64',
  y: 'f64',
});

export const Velocity = defineComponent('frontline_td:movement.velocity', {
  x: 'f64',
  y: 'f64',
});

export const Mover = defineComponent('frontline_td:movement.mover', {
  // cells/tick
  speed: 'f64',
  // cell units
  radius: 'f64',
  // movement-class registry index
  cls: 'u8',
});

// One shared pathing goal id + the unit's slot point (cell centre).
// Permanent component on movers; active: 0 idle, 1 moving, 2 holding the
// slot (steers back when pushed off).
export const MoveTarget = defineComponent('frontline_td:movement.move_target', {
  goal: 'u32',
  x: 'f64',
  y: 'f64',
  active: 'u8',
});

// Transient scalar squad cruise speed cap (ADR 0054 / ADR 0057).
// Permanent internal component on movers; active: 0 unguided, 1 active cap.
export const FormationGuide = defineComponent('frontline_td:movement.formation_guide', {
  maxSpeed: 'f64',
  active: 'u8',
});

// Shared topological corridor-gate chain handle + per-unit progress & lane
// offset (ADR 0056). Permanent internal component on movers; active: 0 none,
// 1 following chain.
export const RouteFollow = defineComponent('frontline_td:movement.route_follow', {
  chain: 'u32',
  gate: 'u16',
  lane: 'f64',
  active: 'u8',
});
