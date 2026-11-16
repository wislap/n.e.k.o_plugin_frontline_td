// Match setup wire format (ADR 0022): validated with the core schema DSL so
// the worker boundary never trusts untyped input.
import { s } from '../core/index';
import type { Infer } from '../core/index';
import { isPackId } from '../core/index';

const CONTENT_HASH_RE = /^[0-9a-f]{16}$/;

const packSchema = s.object({
  id: s.string({ maxLength: 64 }),
  version: s.string({ maxLength: 32 }),
  contentHash: s.string({ pattern: CONTENT_HASH_RE }),
});

const factionSchema = s.object({
  id: s.factionId(),
  archetype: s.optional(s.contentId()),
  controller: s.enumOf(['local', 'none'] as const),
  carryIn: s.object({
    unlocks: s.array(s.contentId(), { maxLength: 512 }),
  }),
  // 开局状态 (ADR 0022): units placed on the map at match start.
  start: s.optional(
    s.object({
      units: s.array(
        s.object({
          unit: s.contentId(),
          x: s.int({ min: 0 }),
          y: s.int({ min: 0 }),
          count: s.int({ min: 1, max: 1024 }),
        }),
        { maxLength: 64 },
      ),
    }),
  ),
});

const relationSchema = s.object({
  a: s.factionId(),
  b: s.factionId(),
  relation: s.enumOf(['hostile', 'allied', 'neutral'] as const),
});

const matchSetupSchema = s.object({
  formatVersion: s.literal(1),
  packs: s.array(packSchema, { maxLength: 64 }),
  mapId: s.optional(s.contentId()),
  seed: s.int({ min: 0, max: 4294967295 }),
  mode: s.optional(s.contentId()),
  factions: s.array(factionSchema, { maxLength: 16 }),
  relations: s.array(relationSchema, { maxLength: 256 }),
});

export type MatchSetup = Infer<typeof matchSetupSchema>;

export type ParseMatchSetupResult =
  { ok: true; setup: MatchSetup } | { ok: false; errors: string[] };

export function parseMatchSetup(value: unknown): ParseMatchSetupResult {
  const result = s.validate(matchSetupSchema, value);
  if (!result.ok) {
    return { ok: false, errors: [`${result.path}: ${result.message}`] };
  }
  const setup = result.value;
  const errors: string[] = [];

  if (setup.packs.length === 0) {
    errors.push('packs: at least one pack is required');
  }
  const packIds = new Set<string>();
  for (const pack of setup.packs) {
    if (packIds.has(pack.id)) {
      errors.push(`packs: duplicate pack id '${pack.id}'`);
    }
    packIds.add(pack.id);
    if (!isPackId(pack.id)) {
      errors.push(`packs: invalid pack id '${pack.id}'`);
    }
  }

  if (setup.factions.length === 0) {
    errors.push('factions: at least one faction is required');
  }
  const factionIds = new Set<number>();
  let localCount = 0;
  for (const faction of setup.factions) {
    if (factionIds.has(faction.id)) {
      errors.push(`factions: duplicate faction id ${faction.id}`);
    }
    factionIds.add(faction.id);
    if (faction.controller === 'local') {
      localCount += 1;
    }
  }
  if (localCount > 1) {
    errors.push("factions: at most one 'local' controller is allowed");
  }

  const pairs = new Set<string>();
  for (const relation of setup.relations) {
    if (!factionIds.has(relation.a)) {
      errors.push(`relations: unknown faction id ${relation.a}`);
    }
    if (!factionIds.has(relation.b)) {
      errors.push(`relations: unknown faction id ${relation.b}`);
    }
    if (relation.a === relation.b) {
      errors.push(`relations: faction ${relation.a} cannot relate to itself`);
    }
    const key =
      relation.a <= relation.b ? `${relation.a}:${relation.b}` : `${relation.b}:${relation.a}`;
    if (pairs.has(key)) {
      errors.push(`relations: duplicate relation for pair ${key}`);
    }
    pairs.add(key);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, setup };
}
