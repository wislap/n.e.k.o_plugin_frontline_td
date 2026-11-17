// Assault mode protocol: victory events and the per-observer match
// state channel. The ended record lets the runtime stop stepping the
// sim once the match is decided (Batch C renders the end screen).
import { defineEvent, defineSnapshotChannel } from '../../core/index';

export const AssaultEliminated = defineEvent<{ faction: number }>(
  'frontline_td:assault.eliminated',
  'all',
);

// winner is the surviving faction id, −1 for a draw.
export const AssaultEnded = defineEvent<{ winner: number; tick: number }>(
  'frontline_td:assault.ended',
  'all',
);

export interface AssaultState {
  ended: number;
  winner: number;
  tick: number;
  eliminated: number[];
}

export const AssaultChannel = defineSnapshotChannel<AssaultState>('frontline_td:assault.state');
