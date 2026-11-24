// Assault director controller: deterministic, no RNG. Decides every 20
// ticks from its own snapshot. Cycle: first gather at 90 s; gather
// window 60 s (+10 s per completed wave, max 120 s); the wave launches
// on the nearest capture ruin or hostile-held outpost to the rally
// point (nearest hostile structure otherwise); breather 45 s after the
// wave squad dies or 150 s after launch. Garrison squads tagged
// 'garrison:<x>,<y>' (footprint top-left, stable across rebuilds) hold
// monsters within 8 cells of each own operational outpost and are
// recreated when destroyed; the remaining monsters form 'hive_guard'
// guarding the hive centre. Strengths steer the generic squads
// reinforcement: the gather squad's strength is the wave cap so hive
// spawns flow into it; at launch the strength is pinned to the live
// member count so later spawns wait for the next gather. Raiders are
// reassigned to a raider squad that raids hostile logistics nodes.
// Squads are identified by opaque tags — 'hive_guard', 'raid',
// 'garrison:<x>,<y>', 'wave:<n>' — never by heuristics. All mutable
// state lives in save()/load() so save/restore mid-match stays
// deterministic.
import { TICKS_PER_SECOND, readChannel } from '../../core/index';
import type { ContentDb } from '../../content/index';
import type { FactionId, Snapshot } from '../../core/index';
import { garrisonTag, nearest, scanStructures } from './director-scan';
import { DenseUnitsChannel } from '../../features/units/protocol';
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
const GARRISON_STRENGTH = 6;
const GARRISON_RADIUS = 6;
// Initial garrison formation range from the outpost centre (cells).
const GARRISON_RANGE_SQ = 8 * 8;

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

  interface UnitRow {
    handle: number;
    x: number;
    y: number;
  }

  function ownUnits(snapshot: Snapshot): {
    monsters: UnitRow[];
    raiders: UnitRow[];
  } {
    const dense = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
    const out = { monsters: [] as UnitRow[], raiders: [] as UnitRow[] };
    if (dense === undefined) {
      return out;
    }
    for (let i = 0; i < dense.handles.length; i++) {
      if (dense.faction[i] !== Number(faction)) {
        continue;
      }
      const row = { handle: dense.handles[i] ?? 0, x: dense.x[i] ?? 0, y: dense.y[i] ?? 0 };
      if (raiderKinds.has(dense.kind[i] ?? -1)) {
        out.raiders.push(row);
      } else {
        out.monsters.push(row);
      }
    }
    return out;
  }

  function ownSquads(snapshot: Snapshot): SquadView[] {
    const snap = readChannel(snapshot, SquadsChannel) ?? undefined;
    return (snap?.squads ?? []).filter((s) => s.faction === Number(faction));
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
      const { hostileAll, nodes, retake, ownOutposts, ownCore } = scanStructures(
        input.snapshot,
        db,
        Number(faction),
        hostile,
        nodeKinds,
      );

      if (phase === 'init') {
        if (units.monsters.length === 0 && units.raiders.length === 0) {
          return;
        }
        // Initial split: monsters within 8 cells of an own operational
        // outpost form its garrison; the rest guard the hive centre.
        const claimed = new Set<number>();
        for (const op of ownOutposts) {
          const members = units.monsters
            .filter(
              (m) =>
                !claimed.has(m.handle) &&
                (m.x - op.cx) * (m.x - op.cx) + (m.y - op.cy) * (m.y - op.cy) <= GARRISON_RANGE_SQ,
            )
            .map((m) => m.handle);
          for (const h of members) {
            claimed.add(h);
          }
          if (members.length > 0) {
            input.issue(SquadsCreate.type, {
              units: members,
              strength: GARRISON_STRENGTH,
              tag: garrisonTag(op.x, op.y),
            });
          }
        }
        const rest = units.monsters.filter((m) => !claimed.has(m.handle));
        if (rest.length > 0) {
          input.issue(SquadsCreate.type, {
            units: rest.map((m) => m.handle),
            strength: rest.length,
            tag: GUARD_TAG,
          });
        }
        if (units.raiders.length > 0) {
          input.issue(SquadsCreate.type, {
            units: units.raiders.map((r) => r.handle),
            strength: units.raiders.length,
            tag: RAID_TAG,
          });
        }
        phase = 'gather';
        return;
      }

      // Guard squad: guard the hive centre once.
      if (guard !== undefined && guard.order.kind === 'idle') {
        input.issue(SquadsOrder.type, {
          squad: guard.id,
          kind: 'guard',
          x: ownCore?.x ?? guard.centroid.x,
          y: ownCore?.y ?? guard.centroid.y,
          radius: GUARD_RADIUS,
        });
      }

      // Garrisons: every own operational outpost gets its squad from the
      // unassigned non-raider pool (refill then happens through generic
      // reinforcement). Garrisons of fallen outposts are left alone —
      // they keep guarding and contest the ruin by presence.
      const assigned = new Set(squads.flatMap((s) => s.members ?? []));
      for (const op of ownOutposts) {
        const g = byTag.get(garrisonTag(op.x, op.y));
        if (g === undefined) {
          const pool = units.monsters.filter((m) => !assigned.has(m.handle)).map((m) => m.handle);
          if (pool.length > 0) {
            input.issue(SquadsCreate.type, {
              units: pool,
              strength: GARRISON_STRENGTH,
              tag: garrisonTag(op.x, op.y),
            });
            for (const h of pool) {
              assigned.add(h);
            }
          }
        } else if (g.order.kind === 'idle') {
          input.issue(SquadsOrder.type, {
            squad: g.id,
            kind: 'guard',
            x: op.cx,
            y: op.cy,
            radius: GARRISON_RADIUS,
          });
        }
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
          const raiderHandles = new Set(units.raiders.map((r) => r.handle));
          const stray = (wave.members ?? []).filter((h) => raiderHandles.has(h));
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
          const pool = units.monsters.filter((m) => !assigned.has(m.handle)).map((m) => m.handle);
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
          // Retake first: nearest capture ruin or hostile-held outpost;
          // otherwise the nearest hostile structure as before.
          const target = nearest(rally, retake) ?? nearest(rally, hostileAll) ?? rally;
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
