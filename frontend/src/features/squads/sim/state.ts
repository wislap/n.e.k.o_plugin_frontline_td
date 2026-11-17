// Squad state: module-level serializable state (ADR 0023 groups). Squad
// ids are a monotonically increasing counter; members are entity
// handles kept sorted; squads are deleted on disband or when they stay
// empty for one update (except while gathering).
import type { Serializable } from '../../../core/index';

type OrderKind = 'idle' | 'guard' | 'advance' | 'gather';
type SquadPhase = 'moving' | 'holding' | 'engaging' | 'returning' | 'resupplying';

interface SquadOrder {
  kind: OrderKind;
  x: number;
  y: number;
  // Guard radius (advance/gather reuse it after arrival).
  radius: number;
  // gather: tick the order becomes advance to (targetX, targetY).
  launchTick?: number;
  targetX?: number;
  targetY?: number;
}

export interface Squad {
  id: number;
  faction: number;
  // Opaque caller tag; never interpreted by the module.
  tag?: string;
  members: number[];
  strength: number;
  order: SquadOrder;
  phase: SquadPhase;
  // Last goal the members were sent to (re-goal threshold 2 cells).
  lastGoal: { x: number; y: number };
  // Hostile handle a guard keeps chasing until it leaves the leash.
  engage?: number;
  // Last tick a blocked-route retarget ran (throttle: RETARGET_PERIOD).
  retarget?: number;
  // Stored gather→target polyline (≤512 cells) for the snapshot.
  route?: number[];
}

export interface SquadsEnv {
  next: number;
  squads: Map<number, Squad>;
}

export function createSquadsEnv(): SquadsEnv {
  return { next: 1, squads: new Map() };
}

interface SavedSquad {
  [key: string]: Serializable;
  id: number;
  faction: number;
  tag?: string;
  members: number[];
  strength: number;
  order: Serializable;
  phase: string;
  lastGoal: Serializable;
  engage?: number;
  retarget?: number;
  route?: number[];
}

export function saveSquads(env: SquadsEnv): Serializable {
  return {
    next: env.next,
    squads: [...env.squads.values()].map((sq): SavedSquad => {
      const out: SavedSquad = {
        id: sq.id,
        faction: sq.faction,
        members: [...sq.members],
        strength: sq.strength,
        order: sq.order as unknown as Serializable,
        phase: sq.phase,
        lastGoal: sq.lastGoal,
      };
      if (sq.tag !== undefined) {
        out.tag = sq.tag;
      }
      if (sq.engage !== undefined) {
        out.engage = sq.engage;
      }
      if (sq.retarget !== undefined) {
        out.retarget = sq.retarget;
      }
      if (sq.route !== undefined) {
        out.route = [...sq.route];
      }
      return out;
    }),
  };
}

export function loadSquads(env: SquadsEnv, data: Serializable): void {
  const saved = data as unknown as { next: number; squads: SavedSquad[] };
  env.next = saved.next;
  env.squads = new Map(
    saved.squads.map((sq) => [
      sq.id,
      {
        id: sq.id,
        faction: sq.faction,
        members: [...sq.members],
        strength: sq.strength,
        order: sq.order as unknown as SquadOrder,
        phase: sq.phase as SquadPhase,
        lastGoal: sq.lastGoal as unknown as { x: number; y: number },
        ...(sq.tag !== undefined ? { tag: sq.tag } : {}),
        ...(sq.engage !== undefined ? { engage: sq.engage } : {}),
        ...(sq.retarget !== undefined ? { retarget: sq.retarget } : {}),
        ...(sq.route !== undefined ? { route: [...sq.route] } : {}),
      },
    ]),
  );
}
