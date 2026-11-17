// Spawn-part factories injected into units' and construction's spawn
// sites: Health at full max (sites included), Targetable radius and
// Weapon when the kind carries one.
import type { ResolvedStructure, ResolvedUnit, ResolvedWeapon } from '../../../content/index';
import { MILLI } from '../../../core/index';
import type { ComponentRef, SpawnInit } from '../../../kernel/index';
import { FREE_COST_CARGO, Health, Targetable, Weapon } from './components';

type Part = readonly [ComponentRef, Record<string, number>?];

function weaponInit(weapon: ResolvedWeapon): Record<string, number> {
  return {
    range: weapon.range,
    damage: weapon.damageMilli,
    cooldown: weapon.cooldownTicks,
    readyAt: 0,
    costCargo: weapon.costCargo < 0 ? FREE_COST_CARGO : weapon.costCargo,
    costAmount: weapon.costMilli,
    target: 0,
  };
}

export function unitParts(unit: ResolvedUnit): SpawnInit {
  const init: Part[] = [
    [Health, { hp: unit.hp * MILLI, max: unit.hp * MILLI }],
    [Targetable, { radius: unit.radius }],
  ];
  if (unit.weapon !== undefined) {
    init.push([Weapon, weaponInit(unit.weapon)]);
  }
  return init;
}

export function structureParts(kind: ResolvedStructure): SpawnInit {
  const init: Part[] = [];
  if (kind.hp !== undefined) {
    const hp = kind.hp * MILLI;
    init.push([Health, { hp, max: hp }]);
  }
  init.push([Targetable, { radius: Math.max(kind.footprint.w, kind.footprint.h) / 2 }]);
  if (kind.weapon !== undefined) {
    init.push([Weapon, weaponInit(kind.weapon)]);
  }
  return init;
}
