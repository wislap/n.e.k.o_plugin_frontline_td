// Turtle bot (M4 D): power + ammo factory, then a ring of turrets around
// the base; robots form guard squads on the approaches. Occasional small
// sorties once the defence is up.
import type { Serializable } from '../../src/core/index';
import type { Controller } from '../../src/kernel/index';
import {
  DECIDE_PERIOD,
  formSquad,
  hasStructure,
  nearest,
  orderSquad,
  ownSquads,
  stockOf,
  structures,
  tryBuild,
  unsquadded,
  type BotOptions,
  type Issue,
} from './common';

const POWER = 'frontline_td:power_plant';
const AMMO = 'frontline_td:ammo_factory';
const TURRET = 'frontline_td:turret';
const FACTORY = 'frontline_td:robot_factory';
const MATERIAL = 'frontline_td:material';
const SQUAD_SIZE = 6;
const TURRETS_WANTED = 3;
const SORTIE_PERIOD = 120 * 20;

export function createTurtleBot(options: BotOptions): Controller {
  const { faction, db, map, hostile } = options;
  const material = db.cargos.byId(MATERIAL)?.index ?? -1;
  const turretKind = db.structures.byId(TURRET)?.index ?? -1;
  let squadSeq = 0;
  let nextSortie = SORTIE_PERIOD;

  return {
    faction,

    save(): Serializable {
      return { squadSeq, nextSortie };
    },

    load(data: Serializable): void {
      const s = data as { squadSeq: number; nextSortie: number };
      squadSeq = s.squadSeq;
      nextSortie = s.nextSortie;
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
      const base = own.find((s) => s.state === 3) ?? own[0];
      if (base === undefined) {
        return;
      }
      const hostileAll = structures(snapshot, db, (f) => hostile.has(f));
      const hive = nearest(base, hostileAll);
      // Defence line ~7 cells from the base toward the enemy.
      const dir = hive !== null ? Math.max(1, Math.hypot(hive.x - base.x, hive.y - base.y)) : 1;
      const guardPoint =
        hive !== null
          ? {
              x: base.x + ((hive.x - base.x) / dir) * 7,
              y: base.y + ((hive.y - base.y) / dir) * 7,
            }
          : base;

      // Build chain: power → ammo → factory → turrets on the line.
      if (!hasStructure(snapshot, db, faction, POWER)) {
        tryBuild(issue, db, map, snapshot, faction, POWER, base, 10);
      } else if (!hasStructure(snapshot, db, faction, AMMO)) {
        tryBuild(issue, db, map, snapshot, faction, AMMO, base, 10);
      } else if (!hasStructure(snapshot, db, faction, FACTORY)) {
        tryBuild(issue, db, map, snapshot, faction, FACTORY, base, 12);
      } else {
        const turrets = own.filter((s) => s.kind === turretKind).length;
        if (turrets < TURRETS_WANTED && stockOf(snapshot, material) >= 20) {
          // Spread along the line: offset each turret perpendicular.
          const px = hive !== null ? (-(hive.y - base.y) / dir) * (turrets - 1) * 4 : 0;
          const py = hive !== null ? ((hive.x - base.x) / dir) * (turrets - 1) * 4 : 0;
          tryBuild(issue, db, map, snapshot, faction, TURRET, {
            x: guardPoint.x + px,
            y: guardPoint.y + py,
          });
        }
      }

      const squads = ownSquads(snapshot, faction);
      const free = unsquadded(snapshot, faction, squads);
      if (free.length >= SQUAD_SIZE && squads.length < 4) {
        formSquad(issue, free, SQUAD_SIZE, `turtle:${squadSeq}`);
        squadSeq += 1;
      }
      // Idle squads guard the approach; a surplus squad sorties on a
      // timer.
      let sorties = 0;
      for (const squad of squads) {
        if (squad.order.kind === 'idle') {
          orderSquad(issue, squad, 'guard', guardPoint.x, guardPoint.y);
        } else if (
          input.tick >= nextSortie &&
          squad.order.kind === 'guard' &&
          hostileAll.length > 0 &&
          sorties === 0 &&
          squads.length >= 3
        ) {
          const target = nearest(squad.centroid, hostileAll);
          if (target !== null) {
            orderSquad(issue, squad, 'advance', target.x, target.y);
            nextSortie = input.tick + SORTIE_PERIOD;
            sorties += 1;
          }
        }
      }
    },
  };
}
