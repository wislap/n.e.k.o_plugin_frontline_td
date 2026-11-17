// The dev-mode match setup used by `npm run dev`: proto_01 with a local
// faction main base at player_start, an enemy main base at enemy_north,
// both with starting stock, and robots spawned around them.
import { proto01 } from '../content/frontline_td/maps/proto_01';
import { basePackManifest } from '../content/packs';
import { contentId, toFactionId } from '../core/index';
import type { MatchSetup } from '../protocol/index';

const ROBOT = contentId('frontline_td:robot');
const RAIDER = contentId('frontline_td:raider');
const MAIN_BASE = contentId('frontline_td:main_base');
const STOCK = {
  'frontline_td:material': 200,
  'frontline_td:ore': 100,
  'frontline_td:energy': 100,
  'frontline_td:ammo': 50,
};

export function createDevSetup(seed: number): MatchSetup {
  const playerStart = proto01.points['player_start'] ?? { x: 0, y: 0 };
  const enemyNorth = proto01.points['enemy_north'] ?? { x: 0, y: 0 };
  const enemyEast = proto01.points['enemy_east'] ?? { x: 0, y: 0 };
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
          // 4x4 at player_start sits on flat plateau cells (x10-13,
          // y52-55, all height 1); the robots spiral-spawn around it.
          structures: [{ structure: MAIN_BASE, x: playerStart.x, y: playerStart.y }],
          units: [{ unit: ROBOT, x: playerStart.x, y: playerStart.y, count: 60 }],
          stock: STOCK,
        },
      },
      {
        id: toFactionId(2),
        // Dev raid controller: periodically attacks player_start.
        controller: 'dev_raid',
        carryIn: { unlocks: [] },
        start: {
          structures: [{ structure: MAIN_BASE, x: enemyNorth.x, y: enemyNorth.y }],
          units: [
            { unit: ROBOT, x: enemyNorth.x, y: enemyNorth.y, count: 30 },
            { unit: RAIDER, x: enemyEast.x, y: enemyEast.y, count: 6 },
          ],
          stock: STOCK,
        },
      },
    ],
    relations: [{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }],
  };
}
