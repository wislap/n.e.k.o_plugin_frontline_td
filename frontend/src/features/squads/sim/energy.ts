// Mean battery level over squad members. Members without a CargoStore
// (e.g. monsters) are skipped via ctx.has — their ids may have been
// recycled from entities that did carry slots, so reading the slot
// arrays unconditionally would return stale cargo data.
import type { EntityId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { CARGO_SLOTS, CargoStore, sget } from '../../logistics/sim/index';

// Mean energy bp over members that have a battery (an energy slot with
// capacity > 0); null when no member carries one.
export function meanEnergyBp(
  ctx: SystemContext,
  ids: readonly number[],
  energyCargo: number,
): number | null {
  const store = ctx.read(CargoStore);
  let sum = 0;
  let count = 0;
  for (const id of ids) {
    if (!ctx.has(CargoStore, id as EntityId)) {
      continue;
    }
    let amt = 0;
    let cap = 0;
    for (let i = 0; i < CARGO_SLOTS; i++) {
      if (sget(store, 'cargo', i, id) === energyCargo && sget(store, 'cap', i, id) > 0) {
        amt += sget(store, 'amt', i, id);
        cap += sget(store, 'cap', i, id);
      }
    }
    if (cap > 0) {
      sum += Math.floor((amt * 10000) / cap);
      count += 1;
    }
  }
  return count === 0 ? null : Math.floor(sum / count);
}
