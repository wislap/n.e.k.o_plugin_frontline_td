// Assault director controller: deterministic, no RNG. Decides every 20
// ticks from its own snapshot. Cycle: first gather at 90 s; gather
// window 60 s (+10 s per completed wave, max 120 s); the wave launches
// on the nearest hostile structure to the rally point; breather 45 s
// after the wave squad dies or 150 s after launch. Strengths steer the
// generic squads reinforcement: the gather squad's strength is the wave
// cap so hive spawns flow into it; at launch the strength is pinned to
// the live member count so later spawns wait for the next gather.
// Raiders are reassigned to a raider squad that raids hostile logistics
// nodes. Squads are identified by opaque tags — 'hive_guard', 'raid',
// 'wave:<n>' — never by heuristics. All mutable state lives in
// save()/load() so save/restore mid-match stays deterministic.
import { TICKS_PER_SECOND } from '../../core/index';
import type { ContentDb } from '../../content/index';
import type { FactionId } from '../../core/index';
import { StructuresChannel } from '../../features/construction/protocol';
import type { ConstructionStructures } from '../../features/construction/protocol';
import { STATE_OPERATIONAL } from '../../features/construction/protocol';
import { DenseUnitsChannel } from '../../features/units/protocol';
import type { DenseUnits } from '../../features/units/protocol';
import { SquadsChannel } from '../../features/squads/protocol';
import type { SquadView } from '../../features/squads/protocol';
import {
  SquadsAssign,
  SquadsCreate,
  SquadsGather,
  SquadsOrder,
  SquadsSetStrength,
} from '../../features/squads/protocol';
import type { Controller } from '../../kernel/index';

const DECIDE_PERIOD = 20;
const FIRST_GATHER_TICK = 90 * TICKS_PER_SECOND;
const GATHER_WINDOW_TICKS = 60 * TICKS_PER_SECOND;
const GATHER_WINDOW_STEP = 10 * TICKS_PER_SECOND;
const GATHER_WINDOW_MAX = 120 * TICKS_PER_SECOND;
const BREATHER_TICKS = 45 * TICKS_PER_SECOND;
const WAVE_TIMEOUT_TICKS = 150 * TICKS_PER_SECOND;
const WAVE_CAP_BASE = 8;
const WAVE_CAP_STEP = 4;
const WAVE_CAP_MAX = 40;
const GUARD_RADIUS = 10;

const GUARD_TAG = 'hive_guard';
const RAID_TAG = 'raid';

export interface DirectorOptions {
  faction: FactionId;
  db: ContentDb;
  rally: { x: number; y: number };
  hostile: ReadonlySet<number>;
}

type Phase = 'init' | 'gather' | 'wave' | 'breather';

export function createDirectorController(options: DirectorOptions): Controller {
  const { faction, db, rally, hostile } = options;
  const raiderKinds = new Set(
    db.units.list.filter((u) => u.interceptor !== undefined).map((u) => u.index),
  );
  const nodeKinds = new Set(
    db.structures.list.filter((s) => s.node !== undefined && !s.node.warehouse).map((s) => s.index),
  );
  let phase: Phase = 'init';
  let wavesDone = 0;
  let gatherStart = FIRST_GATHER_TICK;
  let launchTick = 0;
  let raiderTarget: { x: number; y: number } | null = null;

  function waveTag(): string {
    return `wave:${wavesDone + 1}`;
  }

  function ownUnits(snapshot: { channels: Record<string, unknown> }): {
    monsters: number[];
    raiders: number[];
  } {
    const dense = snapshot.channels[DenseUnitsChannel.id] as DenseUnits | undefined;
    const out = { monsters: [] as number[], raiders: [] as number[] };
    if (dense === undefined) {
      return out;
    }
    for (let i = 0; i < dense.handles.length; i++) {
      if (dense.faction[i] !== Number(faction)) {
        continue;
      }
      const handle = dense.handles[i] ?? 0;
      if (raiderKinds.has(dense.kind[i] ?? -1)) {
        out.raiders.push(handle);
      } else {
        out.monsters.push(handle);
      }
    }
    return out;
  }

  function ownSquads(snapshot: { channels: Record<string, unknown> }): SquadView[] {
    const snap = snapshot.channels[SquadsChannel.id] as { squads: SquadView[] } | undefined;
    return (snap?.squads ?? []).filter((s) => s.faction === Number(faction));
  }

  function hostileStructures(snapshot: { channels: Record<string, unknown> }): {
    all: { handle: number; x: number; y: number }[];
    nodes: { handle: number; x: number; y: number }[];
  } {
    const st = snapshot.channels[StructuresChannel.id] as ConstructionStructures | undefined;
    const all: { handle: number; x: number; y: number }[] = [];
    const nodes: { handle: number; x: number; y: number }[] = [];
    if (st === undefined) {
      return { all, nodes };
    }
    for (let i = 0; i < st.handles.length; i++) {
      if (!hostile.has(st.faction[i] ?? -1)) {
        continue;
      }
      const kind = st.kind[i] ?? -1;
      const def = db.structures.list[kind];
      const cx = (st.x[i] ?? 0) + (def?.footprint.w ?? 1) / 2;
      const cy = (st.y[i] ?? 0) + (def?.footprint.h ?? 1) / 2;
      const entry = { handle: st.handles[i] ?? 0, x: cx, y: cy };
      all.push(entry);
      if (
        nodeKinds.has(kind) &&
        (st.state[i] ?? -1) === STATE_OPERATIONAL &&
        def?.node !== undefined &&
        !def.node.warehouse
      ) {
        nodes.push(entry);
      }
    }
    return { all, nodes };
  }

  function nearest<T extends { x: number; y: number; handle: number }>(
    from: { x: number; y: number },
    list: readonly T[],
  ): T | null {
    let best: T | null = null;
    let bestD = Infinity;
    for (const e of list) {
      const dx = e.x - from.x;
      const dy = e.y - from.y;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && best !== null && e.handle < best.handle)) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  return {
    faction,

    save() {
      return {
        phase,
        wavesDone,
        gatherStart,
        launchTick,
        raiderX: raiderTarget?.x ?? null,
        raiderY: raiderTarget?.y ?? null,
      };
    },

    load(data) {
      const s = data as {
        phase: Phase;
        wavesDone: number;
        gatherStart: number;
        launchTick: number;
        raiderX: number | null;
        raiderY: number | null;
      };
      phase = s.phase;
      wavesDone = s.wavesDone;
      gatherStart = s.gatherStart;
      launchTick = s.launchTick;
      raiderTarget =
        s.raiderX !== null && s.raiderY !== null ? { x: s.raiderX, y: s.raiderY } : null;
    },

    decide(input) {
      if (input.tick % DECIDE_PERIOD !== 0) {
        return;
      }
      const units = ownUnits(input.snapshot);
      const squads = ownSquads(input.snapshot);
      const byTag = new Map<string, SquadView>();
      for (const s of squads) {
        if (s.tag !== undefined) {
          byTag.set(s.tag, s);
        }
      }
      const guard = byTag.get(GUARD_TAG);
      const raid = byTag.get(RAID_TAG);
      const wave = byTag.get(waveTag());
      const { all: hostileAll, nodes } = hostileStructures(input.snapshot);

      if (phase === 'init') {
        if (units.monsters.length === 0 && units.raiders.length === 0) {
          return;
        }
        // Initial monsters guard the hive; raiders form the raider squad.
        if (units.monsters.length > 0) {
          input.issue(SquadsCreate.type, {
            units: units.monsters,
            strength: units.monsters.length,
            tag: GUARD_TAG,
          });
        }
        if (units.raiders.length > 0) {
          input.issue(SquadsCreate.type, {
            units: units.raiders,
            strength: units.raiders.length,
            tag: RAID_TAG,
          });
        }
        phase = 'gather';
        return;
      }

      // Guard squad: guard the hive position (its centroid) once.
      if (guard !== undefined && guard.order.kind === 'idle') {
        input.issue(SquadsOrder.type, {
          squad: guard.id,
          kind: 'guard',
          x: guard.centroid.x,
          y: guard.centroid.y,
          radius: GUARD_RADIUS,
        });
      }

      // Raider squad: advance on the nearest hostile non-warehouse
      // logistics node; retarget when the node falls.
      if (raid !== undefined) {
        const target = nearest(raid.centroid, nodes);
        if (target !== null) {
          const moved =
            raiderTarget === null ||
            raid.order.kind === 'idle' ||
            Math.abs(target.x - raiderTarget.x) > 0.5 ||
            Math.abs(target.y - raiderTarget.y) > 0.5;
          if (moved) {
            input.issue(SquadsOrder.type, {
              squad: raid.id,
              kind: 'advance',
              x: target.x,
              y: target.y,
            });
            raiderTarget = { x: target.x, y: target.y };
          }
        }
        // Pull newly spawned raiders out of the wave squad so raid
        // reinforcement can keep it filled instead.
        if (wave !== undefined) {
          const stray = (wave.members ?? []).filter((h) => units.raiders.includes(h));
          if (stray.length > 0) {
            input.issue(SquadsAssign.type, { squad: raid.id, units: stray });
            input.issue(SquadsSetStrength.type, {
              squad: raid.id,
              strength: Math.min(64, (raid.members?.length ?? 0) + stray.length),
            });
          }
        }
      }

      if (phase === 'gather') {
        if (input.tick < gatherStart) {
          return;
        }
        if (wave === undefined) {
          // Create the wave squad from unassigned non-raider monsters;
          // strength = wave cap so new spawns auto-fill it.
          const assigned = new Set(squads.flatMap((s) => s.members ?? []));
          const pool = units.monsters.filter((h) => !assigned.has(h));
          if (pool.length === 0) {
            return;
          }
          const cap = Math.min(WAVE_CAP_BASE + WAVE_CAP_STEP * wavesDone, WAVE_CAP_MAX);
          input.issue(SquadsCreate.type, { units: pool, strength: cap, tag: waveTag() });
          return;
        }
        if (wave.order.kind === 'idle') {
          const window = Math.min(
            GATHER_WINDOW_TICKS + GATHER_WINDOW_STEP * wavesDone,
            GATHER_WINDOW_MAX,
          );
          // The window runs from the gather's start tick, not the decide
          // tick the squad id resolved on.
          launchTick = gatherStart + window;
          const target = nearest(rally, hostileAll) ?? rally;
          input.issue(SquadsGather.type, {
            squad: wave.id,
            x: rally.x,
            y: rally.y,
            launchTick,
            targetX: target.x,
            targetY: target.y,
          });
          phase = 'wave';
        }
        return;
      }

      if (phase === 'wave') {
        if (wave === undefined) {
          // Squad died out: wave complete, breather before next gather.
          wavesDone += 1;
          phase = 'breather';
          gatherStart = input.tick + BREATHER_TICKS;
          return;
        }
        if (wave.order.kind === 'advance' || wave.order.kind === 'guard') {
          // Launched: pin strength to the live member count so later
          // hive spawns stay unassigned until the next gather.
          const n = Math.max(1, wave.members?.length ?? 0);
          if (wave.strength > n) {
            input.issue(SquadsSetStrength.type, { squad: wave.id, strength: n });
          }
          if (input.tick >= launchTick + WAVE_TIMEOUT_TICKS) {
            wavesDone += 1;
            phase = 'breather';
            gatherStart = input.tick + BREATHER_TICKS;
          }
        }
        return;
      }

      // breather
      if (input.tick >= gatherStart) {
        phase = 'gather';
      }
    },
  };
}
