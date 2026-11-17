// Rush bot (M4 D): robot factory first, then squads of 6–8 advance on
// the enemy base as soon as they form. No defence — everything pushes.
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

const FACTORY = 'frontline_td:robot_factory';
const SQUAD_SIZE = 7;

export function createRushBot(options: BotOptions): Controller {
  const { faction, db, map, hostile } = options;
  let squadSeq = 0;

  return {
    faction,

    save(): Serializable {
      return { squadSeq };
    },

    load(data: Serializable): void {
      squadSeq = (data as { squadSeq: number }).squadSeq;
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
      const squads = ownSquads(snapshot, faction);

      // Factory first, beside the main base.
      if (!hasStructure(snapshot, db, faction, FACTORY)) {
        tryBuild(issue, db, map, snapshot, faction, FACTORY, base, 12);
      }

      // Idle squads keep pushing the nearest remaining hostile.
      for (const squad of squads) {
        if (squad.order.kind !== 'idle') {
          continue;
        }
        const target = nearest(squad.centroid, hostileAll);
        if (target !== null) {
          orderSquad(issue, squad, 'advance', target.x, target.y);
        }
      }

      // New squads of ~7 form and advance immediately.
      const free = unsquadded(snapshot, faction, squads);
      if (free.length >= SQUAD_SIZE && hostileAll.length > 0) {
        formSquad(issue, free, SQUAD_SIZE, `rush:${squadSeq}`);
        squadSeq += 1;
      }
    },
  };
}
