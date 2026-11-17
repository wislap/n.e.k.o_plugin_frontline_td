// Spawn-part factories injected into other features' spawn sites: units
// get their store profile (e.g. the robot's lifeline battery) and the
// construction site/complete phases get node + store components.
import type { ResolvedStoreProfile, ResolvedStructure, ResolvedUnit } from '../../../content/index';
import type { ComponentRef, SpawnInit } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import { CARGO_CONSTRUCTION, SLOT_EXPORT, SLOT_SITE } from '../protocol';
import { CARGO_SLOTS, CargoStore, EMPTY_CARGO, LogisticsNode, SiteStore } from './components';

type Part = readonly [ComponentRef, Record<string, number>?];

function cargoStoreInit(
  profiles: readonly ResolvedStoreProfile[],
  opts: { filled: boolean; site: boolean; tick: number },
): Record<string, number> {
  const values: Record<string, number> = { bottleneck: 0 };
  for (let i = 0; i < CARGO_SLOTS; i++) {
    const p = profiles[i];
    const isExport = p?.export === true;
    const amt = opts.filled ? (p?.capacityMilli ?? 0) : 0;
    values[`cargo${i}`] = p === undefined ? EMPTY_CARGO : p.cargo;
    values[`cap${i}`] = p?.capacityMilli ?? 0;
    values[`amt${i}`] = amt;
    values[`cls${i}`] = p?.cls ?? 0;
    values[`flags${i}`] = (isExport ? SLOT_EXPORT : 0) | (opts.site ? SLOT_SITE : 0);
    // since = tick + 1 (0 = none): every slot spawned non-full is an open
    // demand from birth, except export buffers which carry no demand.
    values[`since${i}`] = p !== undefined && !isExport && amt < p.capacityMilli ? opts.tick + 1 : 0;
    values[`rate${i}`] = p?.rateMilliPerCycle ?? 0;
    values[`unmet${i}`] = 0;
  }
  return values;
}

// A unit's declared store profile becomes its CargoStore; the robot's
// lifeline battery (energy 60, −0.05/s) is defined in the pack.
export function unitParts(unit: ResolvedUnit): SpawnInit {
  const stores = unit.stores ?? [];
  if (stores.length === 0) {
    return [];
  }
  return [[CargoStore, cargoStoreInit(stores, { filled: true, site: false, tick: 0 })]];
}

// Site-phase store init: one empty slot per build-cost cargo, class
// construction so it competes with other construction demands.
function siteStoreInit(kind: ResolvedStructure, tick: number): Record<string, number> {
  const cost = kind.build?.cost ?? [];
  const values: Record<string, number> = { bottleneck: 0 };
  for (let i = 0; i < CARGO_SLOTS; i++) {
    const c = cost[i];
    values[`cargo${i}`] = c === undefined ? EMPTY_CARGO : c.cargo;
    values[`cap${i}`] = c?.milli ?? 0;
    values[`amt${i}`] = 0;
    values[`cls${i}`] = c === undefined ? 0 : CARGO_CONSTRUCTION;
    values[`flags${i}`] = c === undefined ? 0 : SLOT_SITE;
    values[`since${i}`] = c === undefined ? 0 : tick + 1;
    values[`rate${i}`] = 0;
    values[`unmet${i}`] = 0;
  }
  return values;
}

// A CargoStore whose filled slots are pure export buffers (cargo, amt =
// cap = refund, export flag, since = tick + 1). Used by construction's
// salvage piles so the store layout stays logistics-owned.
export function exportStoreInit(
  refunds: readonly { cargo: number; milli: number }[],
  tick: number,
): Record<string, number> {
  const values: Record<string, number> = { bottleneck: 0 };
  for (let i = 0; i < CARGO_SLOTS; i++) {
    const r = refunds[i];
    values[`cargo${i}`] = r === undefined ? EMPTY_CARGO : r.cargo;
    values[`cap${i}`] = r?.milli ?? 0;
    values[`amt${i}`] = r?.milli ?? 0;
    values[`cls${i}`] = 0;
    values[`flags${i}`] = r === undefined ? 0 : SLOT_EXPORT;
    values[`since${i}`] = r === undefined ? 0 : tick + 1;
    values[`rate${i}`] = 0;
    values[`unmet${i}`] = 0;
  }
  return values;
}

// Structure spawn parts for the two phases. `site` places a SiteStore
// marker with one demand slot per build cost cargo; `complete` places
// the operational store profile. The node sits at the footprint centre.
export function structureParts(
  kind: ResolvedStructure,
  x: number,
  y: number,
  phase: 'site' | 'complete',
  tick: number,
): SpawnInit {
  const init: Part[] = [[Position, { x: x + kind.footprint.w / 2, y: y + kind.footprint.h / 2 }]];
  if (kind.node !== undefined) {
    init.push([
      LogisticsNode,
      {
        connect: kind.node.connect,
        service: kind.node.service,
        vehicles: kind.node.vehicles,
        warehouse: kind.node.warehouse ? 1 : 0,
        w: kind.footprint.w,
        h: kind.footprint.h,
      },
    ]);
  }
  init.push([
    CargoStore,
    phase === 'site'
      ? siteStoreInit(kind, tick)
      : cargoStoreInit(kind.stores ?? [], { filled: false, site: false, tick }),
  ]);
  if (phase === 'site') {
    init.push([SiteStore, { kind: kind.index }]);
  }
  return init;
}
