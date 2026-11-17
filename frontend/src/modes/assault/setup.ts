// Assault mode default match setup: proto_01, a local main base at
// player_start with 24 robots and starting stock, and a director
// faction with a hive at enemy_north (12 crawlers + 4 spitters) and
// 6 raiders at enemy_east.
import { proto01 } from '../../content/frontline_td/maps/proto_01';
import { basePackManifest } from '../../content/packs';
import { contentId, toFactionId } from '../../core/index';
import type { MatchSetup } from '../../protocol/index';

export const ASSAULT_MODE_ID = 'frontline_td:assault';

const ROBOT = contentId('frontline_td:robot');
const CRAWLER = contentId('frontline_td:crawler');
const SPITTER = contentId('frontline_td:spitter');
const RAIDER = contentId('frontline_td:raider');
const MAIN_BASE = contentId('frontline_td:main_base');
const HIVE = contentId('frontline_td:hive');
const STOCK = {
  'frontline_td:material': 200,
  'frontline_td:ore': 100,
  'frontline_td:energy': 100,
  'frontline_td:ammo': 50,
};

export function defaultSetup(seed: number): MatchSetup {
  const playerStart = proto01.points['player_start'] ?? { x: 0, y: 0 };
  const enemyNorth = proto01.points['enemy_north'] ?? { x: 0, y: 0 };
  const enemyEast = proto01.points['enemy_east'] ?? { x: 0, y: 0 };
  return {
    formatVersion: 1,
    packs: [basePackManifest()],
    mapId: proto01.id,
    mode: contentId(ASSAULT_MODE_ID),
    seed,
    factions: [
      {
        id: toFactionId(1),
        controller: 'local',
        carryIn: { unlocks: [] },
        start: {
          structures: [{ structure: MAIN_BASE, x: playerStart.x, y: playerStart.y }],
          units: [{ unit: ROBOT, x: playerStart.x, y: playerStart.y, count: 24 }],
          stock: STOCK,
        },
      },
      {
        id: toFactionId(2),
        controller: 'director',
        carryIn: { unlocks: [] },
        start: {
          structures: [{ structure: HIVE, x: enemyNorth.x, y: enemyNorth.y }],
          units: [
            { unit: CRAWLER, x: enemyNorth.x, y: enemyNorth.y, count: 12 },
            { unit: SPITTER, x: enemyNorth.x, y: enemyNorth.y, count: 4 },
            { unit: RAIDER, x: enemyEast.x, y: enemyEast.y, count: 6 },
          ],
        },
      },
    ],
    relations: [{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }],
  };
}
