// Squads protocol: formation/order commands plus the per-observer squad
// snapshot channel. Sim-internal only in M4 (no client) — the client
// arrives with the box-select batch; commands are still validate-first.
import { defineCommand, defineEvent, defineSnapshotChannel, s } from '../../core/index';

// Payload `units` are entity handles; `squad` is a squad id.
export const SquadsCreate = defineCommand(
  'frontline_td:squads.create',
  s.object({
    units: s.array(s.handle(), { maxLength: 256 }),
    strength: s.optional(s.int({ min: 1, max: 64 })),
    // Opaque caller tag (e.g. a mode's 'wave:2'); stored, serialized and
    // exposed on the channel — the squads module never interprets it.
    tag: s.optional(s.string({ maxLength: 24 })),
  }),
);

export const SquadsAssign = defineCommand(
  'frontline_td:squads.assign',
  s.object({
    squad: s.int({ min: 0 }),
    units: s.array(s.handle(), { maxLength: 256 }),
  }),
);

export const SquadsDisband = defineCommand(
  'frontline_td:squads.disband',
  s.object({ squad: s.int({ min: 0 }) }),
);

export const SquadsSetStrength = defineCommand(
  'frontline_td:squads.set_strength',
  s.object({ squad: s.int({ min: 0 }), strength: s.int({ min: 1, max: 64 }) }),
);

const SQUAD_ORDER_KINDS = ['guard', 'advance'] as const;
export const SquadsOrder = defineCommand(
  'frontline_td:squads.order',
  s.object({
    squad: s.int({ min: 0 }),
    kind: s.enumOf(SQUAD_ORDER_KINDS),
    x: s.number(),
    y: s.number(),
    radius: s.optional(s.int({ min: 1, max: 16 })),
  }),
);

export const SquadsGather = defineCommand(
  'frontline_td:squads.gather',
  s.object({
    squad: s.int({ min: 0 }),
    x: s.number(),
    y: s.number(),
    launchTick: s.int({ min: 0 }),
    targetX: s.number(),
    targetY: s.number(),
  }),
);

// Emitted when a gathering squad's launchTick arrives and its order
// becomes advance — the wave has launched.
export const SquadsLaunched = defineEvent<{
  squad: number;
  faction: number;
  x: number;
  y: number;
}>('frontline_td:squads.launched', 'all');

interface SquadOrderView {
  kind: 'idle' | 'guard' | 'advance' | 'gather';
  x: number;
  y: number;
  radius: number;
  launchTick?: number;
  targetX?: number;
  targetY?: number;
}

// Full view of an own squad; hostiles only expose the public fields.
export interface SquadView {
  id: number;
  faction: number;
  // Opaque tag the creator passed (not interpreted by the module).
  tag?: string;
  members?: number[];
  // Live member count for every faction (the threat UI needs it even
  // though hostile member handle lists stay hidden).
  memberCount: number;
  strength: number;
  order: SquadOrderView;
  phase: string;
  centroid: { x: number; y: number };
  meanEnergyBp?: number;
  // Stored gather→target polyline (≤512 cells, cell centres).
  route?: number[];
}

export interface SquadsSnapshot {
  squads: SquadView[];
}

export const SquadsChannel = defineSnapshotChannel<SquadsSnapshot>('frontline_td:squads.squads');
