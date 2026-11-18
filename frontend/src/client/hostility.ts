// Client-side hostility predicate (M5 batch D): the same 'relations' the
// sim resolves from MatchSetup, threaded to render/placement code so
// exclusion zones and ghost previews use real hostility instead of the
// 'not me, not neutral' default. Mirrors kernel relationOf: symmetric
// pair keys, 'neutral' default, faction 0 (nature) never hostile.
import type { FactionId, FactionRelation } from '../core/index';

export function makeIsHostile(
  relations: readonly { a: FactionId; b: FactionId; relation: FactionRelation }[],
): (observer: number, faction: number) => boolean {
  const pairs = new Map<string, FactionRelation>();
  for (const { a, b, relation } of relations) {
    pairs.set(a <= b ? `${a}:${b}` : `${b}:${a}`, relation);
  }
  return (observer, faction) => {
    if (faction === 0 || faction === observer) {
      return false;
    }
    const key = observer <= faction ? `${observer}:${faction}` : `${faction}:${observer}`;
    return (pairs.get(key) ?? 'neutral') === 'hostile';
  };
}
