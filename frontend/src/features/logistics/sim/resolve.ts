// Per-tick resolution system (extracted from module.ts to keep it under
// the file-length ratchet): consume/deposit intents first, then the site
// conversion that swaps site slots for the operational store profile
// once UnderConstruction is gone.
import type { ContentDb } from '../../../content/index';
import type { EntityHandle, EntityId } from '../../../core/index';
import type { SimBuilder } from '../../../kernel/index';
import { UnderConstruction } from '../../../kernel/index';
import { ConsumeIntent, DepositIntent, SLOT_EXPORT, UNMET_NONE } from '../protocol';
import { CARGO_SLOTS, CargoStore, EMPTY_CARGO, SiteStore } from './components';
import type { LogisticsEnv } from './env';
import { sget, sset } from './slots';

export function registerResolve(builder: SimBuilder, env: LogisticsEnv, db: ContentDb): void {
  builder.system({
    id: 'frontline_td:logistics.resolve',
    phase: 'logistics',
    reads: [ConsumeIntent, DepositIntent],
    run(ctx) {
      const store = ctx.write(env.cargoW);
      for (const p of ctx.read(ConsumeIntent)) {
        const id = ctx.resolve(p.handle as EntityHandle);
        if (id === null || !ctx.has(CargoStore, id)) {
          continue;
        }
        for (let i = 0; i < CARGO_SLOTS; i++) {
          if (sget(store, 'cargo', i, id) === p.cargo && sget(store, 'amt', i, id) > 0) {
            sset(store, 'amt', i, id, Math.max(0, sget(store, 'amt', i, id) - p.amount));
            break;
          }
        }
      }
      for (const p of ctx.read(DepositIntent)) {
        const id = ctx.resolve(p.handle as EntityHandle);
        if (id === null || !ctx.has(CargoStore, id)) {
          continue;
        }
        for (let i = 0; i < CARGO_SLOTS; i++) {
          if (
            sget(store, 'cargo', i, id) === p.cargo &&
            (sget(store, 'flags', i, id) & SLOT_EXPORT) !== 0
          ) {
            sset(
              store,
              'amt',
              i,
              id,
              Math.min(sget(store, 'cap', i, id), sget(store, 'amt', i, id) + p.amount),
            );
            break;
          }
        }
      }
      // Site conversion: once UnderConstruction is gone the site slots
      // become the structure's operational store profile.
      const site = ctx.read(SiteStore);
      for (const id of ctx.query([SiteStore], [UnderConstruction])) {
        const structure = db.structures.byIndex(site.kind[id] ?? 0);
        const handle = ctx.handleOf(id as EntityId);
        if (structure === undefined || handle === null) {
          continue;
        }
        const profiles = structure.stores ?? [];
        for (let i = 0; i < CARGO_SLOTS; i++) {
          const p = profiles[i];
          sset(store, 'cargo', i, id, p === undefined ? EMPTY_CARGO : p.cargo);
          sset(store, 'cap', i, id, p?.capacityMilli ?? 0);
          sset(store, 'amt', i, id, 0);
          sset(store, 'cls', i, id, p?.cls ?? 0);
          sset(store, 'flags', i, id, p?.export === true ? SLOT_EXPORT : 0);
          sset(store, 'since', i, id, p !== undefined && !p.export ? ctx.tick + 1 : 0);
          sset(store, 'rate', i, id, p?.rateMilliPerCycle ?? 0);
          sset(store, 'unmet', i, id, UNMET_NONE);
        }
        ctx.removeComponent(env.siteW, handle);
      }
    },
  });
}
