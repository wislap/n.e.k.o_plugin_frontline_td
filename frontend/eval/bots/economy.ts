// Economy bot (M4 D): starting robots stay home as a guard squad; expand
// first — power, a station toward the nearest ore field, two miners,
// then a factory — and launch one big push only once the economy is up
// (factory + 2 miners operational, ≥16 robots in squads) or 8 minutes
// have passed.
import type { Serializable } from '../../src/core/index';
import type { Controller } from '../../src/kernel/index';
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
const STATION = 'frontline_td:station';
const MINER = 'frontline_td:miner';
const FACTORY = 'frontline_td:robot_factory';
const ORE = 'frontline_td:ore';
const OPERATIONAL = 3;
const GUARD_SIZE = 8;
const SQUAD_SIZE = 8;
const MINERS_WANTED = 2;
const PUSH_ARMY = 16;
const PUSH_DEADLINE = 8 * 60 * 20;

export function createEconomyBot(options: BotOptions): Controller {
  const { faction, db, map, hostile } = options;
  const ore = db.cargos.byId(ORE)?.index ?? -1;
  const minerKind = db.structures.byId(MINER)?.index ?? -1;
  const factoryKind = db.structures.byId(FACTORY)?.index ?? -1;
  // Static deposit cells from the map grid (surfaces never change).
  const deposits: { x: number; y: number }[] = [];
  const { width, height, surfaces } = map.grid;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((db.surfaces.byIndex(surfaces[y * width + x] ?? 0)?.deposit ?? -1) === ore) {
        deposits.push({ x, y });
      }
    }
  }
  let squadSeq = 0;
  let pushed = false;

  return {
    faction,

    save(): Serializable {
      return { squadSeq, pushed };
    },

    load(data: Serializable): void {
      const s = data as { squadSeq: number; pushed: boolean };
      squadSeq = s.squadSeq;
      pushed = s.pushed;
    },

    decide(input) {
      if (input.tick % DECIDE_PERIOD !== 0) {
        return;
      }
      const issue: Issue = (type, payload) => {
        input.issue(type, payload);
      };
      const snapshot = input.snapshot;
      const own = structures(snapshot, db, (f) => f === Number(faction));
      const base = own.find((s) => s.state === OPERATIONAL) ?? own[0];
      if (base === undefined) {
        return;
      }
      const hostileAll = structures(snapshot, db, (f) => hostile.has(f));
      const hive = nearest(base, hostileAll);
      // Home guard sits ~7 cells from the base on the enemy line.
      const d = hive !== null ? Math.max(1, Math.hypot(hive.x - base.x, hive.y - base.y)) : 1;
      const guardPoint =
        hive !== null
          ? { x: base.x + ((hive.x - base.x) / d) * 7, y: base.y + ((hive.y - base.y) / d) * 7 }
          : base;

      const miners = own.filter((s) => s.kind === minerKind && s.state === OPERATIONAL).length;
      const factoryUp = own.some((s) => s.kind === factoryKind && s.state === OPERATIONAL);

      // Expansion chain: power → station toward the field → miners →
      // factory. One build action per decide keeps the build queue sane.
      const deposit = deposits.reduce<{ x: number; y: number } | null>((best, cell) => {
        if (best === null) {
          return cell;
        }
        const d0 = (cell.x - base.x) ** 2 + (cell.y - base.y) ** 2;
        const d1 = (best.x - base.x) ** 2 + (best.y - base.y) ** 2;
        return d0 < d1 ? cell : best;
      }, null);
      if (!hasStructure(snapshot, db, faction, POWER)) {
        tryBuild(issue, db, map, snapshot, faction, POWER, base, 10);
      } else if (deposit !== null && miners < MINERS_WANTED) {
        if (!tryBuild(issue, db, map, snapshot, faction, MINER, deposit, 4)) {
          const mid = { x: (base.x + deposit.x) / 2, y: (base.y + deposit.y) / 2 };
          tryBuild(issue, db, map, snapshot, faction, STATION, mid, 8);
        }
      } else if (!hasStructure(snapshot, db, faction, FACTORY)) {
        tryBuild(issue, db, map, snapshot, faction, FACTORY, base, 12);
      }

      // Army: the first squad is the permanent home guard; further squads
      // mass near the base until the push.
      const squads = ownSquads(snapshot, faction);
      const free = unsquadded(snapshot, faction, squads);
      if (squads.length === 0 && free.length >= GUARD_SIZE) {
        formSquad(issue, free, GUARD_SIZE, 'eco_guard');
      } else if (squads.length > 0 && free.length >= SQUAD_SIZE) {
        formSquad(issue, free, SQUAD_SIZE, `eco:${squadSeq}`);
        squadSeq += 1;
      }
      const army = squads.reduce((a, s) => a + s.memberCount, 0);
      if (
        !pushed &&
        (input.tick >= PUSH_DEADLINE || (factoryUp && miners >= MINERS_WANTED && army >= PUSH_ARMY))
      ) {
        pushed = true;
      }
      for (const squad of squads) {
        if (squad.order.kind !== 'idle') {
          continue;
        }
        if (squad.tag === 'eco_guard' || !pushed) {
          orderSquad(issue, squad, 'guard', guardPoint.x, guardPoint.y);
        } else {
          const target = nearest(squad.centroid, hostileAll);
          if (target !== null) {
            orderSquad(issue, squad, 'advance', target.x, target.y);
          }
        }
      }
    },
  };
}
