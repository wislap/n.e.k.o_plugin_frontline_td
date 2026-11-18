// Stat & modifier pipeline (ADR 0013): a stat is a named content-id; a
// modifier is a component ({value: i32}) registered under a stat. Membership
// means the modifier is active, so claimWriter/addComponent/removeComponent/
// serialization/despawn cleanup all come from the component machinery.
import { parseContentId } from '../core/index';
import { defineComponent } from './components';
import type { ComponentRef } from './components';

export type ModifierOp = 'add' | 'mul_bp';

export interface StatRef {
  readonly id: string;
}

// A ModifierRef IS a ComponentRef with fields {value: 'i32'}; the stat/op
// metadata rides on the same object so COMPONENT_REGISTRY stays the single
// source of truth for save/restore.
export interface ModifierRef extends ComponentRef<{ value: 'i32' }> {
  readonly stat: StatRef;
  readonly op: ModifierOp;
}

// One active modifier's contribution to an entity, for ctx.modifiersOf.
export interface ModifierSource {
  stat: string;
  source: string;
  op: ModifierOp;
  value: number;
}

const STAT_REGISTRY = new Map<string, StatRef>();
// Per stat, sources sorted by source id for deterministic iteration.
const MODIFIERS_BY_STAT = new Map<string, ModifierRef[]>();
const MODIFIER_REGISTRY = new Map<string, ModifierRef>();

export function defineStat(id: string): StatRef {
  if (parseContentId(id) === null) {
    throw new Error(`invalid stat id '${id}'`);
  }
  const existing = STAT_REGISTRY.get(id);
  if (existing !== undefined) {
    return existing;
  }
  const stat: StatRef = { id };
  STAT_REGISTRY.set(id, stat);
  return stat;
}

export function defineModifier(id: string, stat: StatRef, op: ModifierOp): ModifierRef {
  const existing = MODIFIER_REGISTRY.get(id);
  if (existing !== undefined) {
    if (existing.stat !== stat || existing.op !== op) {
      throw new Error(`modifier '${id}' already defined for a different stat or op`);
    }
    return existing;
  }
  const ref = defineComponent(id, { value: 'i32' });
  const modifier = Object.assign(ref, { stat, op });
  MODIFIER_REGISTRY.set(id, modifier);
  const sources = MODIFIERS_BY_STAT.get(stat.id) ?? [];
  const insertAt = sources.findIndex((source) => source.id > id);
  if (insertAt === -1) {
    sources.push(modifier);
  } else {
    sources.splice(insertAt, 0, modifier);
  }
  MODIFIERS_BY_STAT.set(stat.id, sources);
  return modifier;
}

// The stat's modifier refs in ascending source-id order (deterministic).
export function statSources(stat: StatRef): readonly ModifierRef[] {
  return MODIFIERS_BY_STAT.get(stat.id) ?? [];
}

// All modifiers, sorted by (stat id, source id) — the modifiersOf order.
export function allModifierSources(): readonly ModifierRef[] {
  const out: ModifierRef[] = [];
  for (const statId of [...MODIFIERS_BY_STAT.keys()].sort()) {
    out.push(...(MODIFIERS_BY_STAT.get(statId) ?? []));
  }
  return out;
}

// combine(base, adds, mulBp): the shared stacking rule. mul_bp values sum
// into one basis-point multiplier clamped at -100%. Stats are fractional
// (geometry); callers needing integer quantities floor themselves.
export function combineStat(base: number, add: number, mulBp: number): number {
  const bp = Math.max(0, 10000 + mulBp);
  return ((base + add) * bp) / 10000;
}
