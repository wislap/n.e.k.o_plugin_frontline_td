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

export interface SquadSlot {
  handle: number;
  fwd: number;
  right: number;
  destX: number;
  destY: number;
}

interface SquadHeading {
  hx: number;
  hy: number;
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
  // Persistent role-ordered formation slots (ADR 0054).
  slots?: SquadSlot[];
  // Cached advance heading for incremental reinforcement projection (ADR 0058).
  heading?: SquadHeading;
  // True while scalar FormationGuideIntent cruise caps are active on members.
  guideActive?: boolean;
  // Set on new SquadsOrder / SquadsGather so updateSquad runs on the next tick (ADR 0057).
  immediate?: boolean;
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
  slots?: Serializable;
  heading?: Serializable;
  guideActive?: boolean;
  immediate?: boolean;
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
        lastGoal: { ...sq.lastGoal },
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
      if (sq.slots !== undefined) {
        out.slots = sq.slots.map((s) => ({ ...s }));
      }
      if (sq.heading !== undefined) {
        out.heading = { ...sq.heading };
      }
      if (sq.guideActive !== undefined) {
        out.guideActive = sq.guideActive;
      }
      if (sq.immediate !== undefined) {
        out.immediate = sq.immediate;
      }
      return out;
    }),
  };
}

export function loadSquads(env: SquadsEnv, data: Serializable): void {
  const saved = data as unknown as { next: number; squads: SavedSquad[] };
  env.next = saved.next;
  env.squads = new Map(
    saved.squads.map((sq) => {
      const lastGoal = sq.lastGoal as unknown as { x: number; y: number };
      return [
        sq.id,
        {
          id: sq.id,
          faction: sq.faction,
          members: [...sq.members],
          strength: sq.strength,
          order: { ...(sq.order as unknown as SquadOrder) },
          phase: sq.phase as SquadPhase,
          lastGoal: { x: lastGoal.x, y: lastGoal.y },
          ...(sq.tag !== undefined ? { tag: sq.tag } : {}),
          ...(sq.engage !== undefined ? { engage: sq.engage } : {}),
          ...(sq.retarget !== undefined ? { retarget: sq.retarget } : {}),
          ...(sq.route !== undefined ? { route: [...sq.route] } : {}),
          ...(sq.slots !== undefined
            ? { slots: (sq.slots as unknown as SquadSlot[]).map((s) => ({ ...s })) }
            : {}),
          ...(sq.heading !== undefined
            ? { heading: { ...(sq.heading as unknown as SquadHeading) } }
            : {}),
          ...(sq.guideActive !== undefined ? { guideActive: sq.guideActive } : {}),
          ...(sq.immediate !== undefined ? { immediate: sq.immediate } : {}),
        },
      ];
    }),
  );
}
