// Balanced bot (M4 D): power + factory, two guard squads on the main
// approaches, and a push on the enemy base after two waves have been
// survived (counted from squads.launched events in the snapshot).
import type { Serializable } from '../../src/core/index';
import type { Controller } from '../../src/kernel/index';
import { SquadsLaunched } from '../../src/features/squads/protocol';
import {
  DECIDE_PERIOD,
  formSquad,
  hasStructure,
  nearest,
  orderSquad,
  ownSquads,
  structures,
  tryBuild,
  unsquadded,
  type BotOptions,
  type Issue,
} from './common';

const POWER = 'frontline_td:power_plant';
const FACTORY = 'frontline_td:robot_factory';
const SQUAD_SIZE = 6;
const PUSH_AFTER_WAVES = 2;

export function createBalancedBot(options: BotOptions): Controller {
  const { faction, db, map, hostile } = options;
  let squadSeq = 0;
  let wavesSeen = 0;

  return {
    faction,

    save(): Serializable {
      return { squadSeq, wavesSeen };
    },

    load(data: Serializable): void {
      const s = data as { squadSeq: number; wavesSeen: number };
      squadSeq = s.squadSeq;
      wavesSeen = s.wavesSeen;
    },

    decide(input) {
      if (input.tick % DECIDE_PERIOD !== 0) {
        return;
      }
      const issue: Issue = (type, payload) => {
        input.issue(type, payload);
      };
      const snapshot = input.snapshot;
      for (const event of snapshot.events) {
        const faction_ = (event.payload as { faction?: number } | null)?.faction;
        if (event.type === SquadsLaunched.type && faction_ !== undefined && hostile.has(faction_)) {
          wavesSeen += 1;
        }
      }
      const own = structures(snapshot, db, (f) => f === Number(faction));
      const base = own.find((s) => s.state === 3) ?? own[0];
      if (base === undefined) {
        return;
      }
      const hostileAll = structures(snapshot, db, (f) => hostile.has(f));
      const hive = nearest(base, hostileAll);
      const d = hive !== null ? Math.max(1, Math.hypot(hive.x - base.x, hive.y - base.y)) : 1;
      // Two approach guards on the shortest line to the enemy, offset
      // perpendicular so they don't stack.
      const ux = hive !== null ? (hive.x - base.x) / d : 0;
      const uy = hive !== null ? (hive.y - base.y) / d : 1;
      const guardPoints = [
        { x: base.x + ux * 8 - uy * 5, y: base.y + uy * 8 + ux * 5 },
        { x: base.x + ux * 8 + uy * 5, y: base.y + uy * 8 - ux * 5 },
      ];

      if (!hasStructure(snapshot, db, faction, POWER)) {
        tryBuild(issue, db, map, snapshot, faction, POWER, base, 10);
      } else if (!hasStructure(snapshot, db, faction, FACTORY)) {
        tryBuild(issue, db, map, snapshot, faction, FACTORY, base, 12);
      }

      const squads = ownSquads(snapshot, faction);
      const free = unsquadded(snapshot, faction, squads);
      if (free.length >= SQUAD_SIZE) {
        formSquad(issue, free, SQUAD_SIZE, `bal:${squadSeq}`);
        squadSeq += 1;
      }
      const pushing = wavesSeen >= PUSH_AFTER_WAVES;
      let gi = 0;
      for (const squad of squads) {
        if (squad.order.kind === 'idle') {
          if (pushing && squads.length > guardPoints.length && gi >= guardPoints.length) {
            const target = nearest(squad.centroid, hostileAll);
            if (target !== null) {
              orderSquad(issue, squad, 'advance', target.x, target.y);
            }
          } else {
            const point = guardPoints[Math.min(gi, guardPoints.length - 1)];
            if (point !== undefined) {
              orderSquad(issue, squad, 'guard', point.x, point.y);
            }
            gi += 1;
          }
        } else if (squad.order.kind === 'guard' && pushing && squad.memberCount >= SQUAD_SIZE) {
          // Guards holding full squads join the push once two waves are
          // survived; the smallest guard stays home.
          if (gi < squads.length - 1) {
            const target = nearest(squad.centroid, hostileAll);
            if (target !== null) {
              orderSquad(issue, squad, 'advance', target.x, target.y);
            }
          }
          gi += 1;
        }
      }
    },
  };
}
