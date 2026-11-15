// The dev-mode match setup used by `npm run dev`: one local faction in a
// three-faction hostile scenario on an empty map.
import { basePackManifest } from '../content/packs';
import { toFactionId } from '../core/index';
import type { MatchSetup } from '../protocol/index';

export function createDevSetup(seed: number): MatchSetup {
  return {
    formatVersion: 1,
    packs: [basePackManifest()],
    seed,
    factions: [
      { id: toFactionId(0), controller: 'none', carryIn: { unlocks: [] } },
      { id: toFactionId(1), controller: 'local', carryIn: { unlocks: [] } },
      { id: toFactionId(2), controller: 'none', carryIn: { unlocks: [] } },
    ],
    relations: [{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }],
  };
}
