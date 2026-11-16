// The dev-mode match setup used by `npm run dev`: proto_01 with a local
// faction of 60 robots at player_start and 30 idle robots for faction 2 at
// enemy_north (present only so both factions are visible).
import { proto01 } from '../content/frontline_td/maps/proto_01';
import { basePackManifest } from '../content/packs';
import { contentId, toFactionId } from '../core/index';
import type { MatchSetup } from '../protocol/index';

const ROBOT = contentId('frontline_td:robot');

export function createDevSetup(seed: number): MatchSetup {
  const playerStart = proto01.points['player_start'] ?? { x: 0, y: 0 };
  const enemyNorth = proto01.points['enemy_north'] ?? { x: 0, y: 0 };
  return {
    formatVersion: 1,
    packs: [basePackManifest()],
    mapId: proto01.id,
    seed,
    factions: [
      {
        id: toFactionId(1),
        controller: 'local',
        carryIn: { unlocks: [] },
        start: {
          units: [{ unit: ROBOT, x: playerStart.x, y: playerStart.y, count: 60 }],
        },
      },
      {
        id: toFactionId(2),
        controller: 'none',
        carryIn: { unlocks: [] },
        start: {
          units: [{ unit: ROBOT, x: enemyNorth.x, y: enemyNorth.y, count: 30 }],
        },
      },
    ],
    relations: [{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }],
  };
}
