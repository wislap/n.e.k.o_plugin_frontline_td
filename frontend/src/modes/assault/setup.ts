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
const OUTPOST = contentId('frontline_td:outpost');
const STOCK = {
  'frontline_td:material': 200,
  'frontline_td:ore': 100,
  'frontline_td:energy': 100,
  'frontline_td:ammo': 50,
};

// A required named map point: missing entries are content bugs, not
// (0,0) spawn positions.
export function requirePoint(
  map: { id: string; points: Record<string, { x: number; y: number } | undefined> },
  name: string,
): { x: number; y: number } {
  const point = map.points[name];
  if (point === undefined) {
    throw new Error(`map '${map.id}' is missing required point '${name}'`);
  }
  return point;
}

export function defaultSetup(seed: number): MatchSetup {
  const playerStart = requirePoint(proto01, 'player_start');
  const enemyNorth = requirePoint(proto01, 'enemy_north');
  const enemyEast = requirePoint(proto01, 'enemy_east');
  const outpostSouth = requirePoint(proto01, 'outpost_south');
  const outpostWest = requirePoint(proto01, 'outpost_west');
  const outpostEast = requirePoint(proto01, 'outpost_east');
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
        vision: 'omniscient',
        carryIn: { unlocks: [] },
        start: {
          structures: [
            { structure: HIVE, x: enemyNorth.x, y: enemyNorth.y },
            { structure: OUTPOST, x: outpostSouth.x, y: outpostSouth.y },
            { structure: OUTPOST, x: outpostWest.x, y: outpostWest.y },
            { structure: OUTPOST, x: outpostEast.x, y: outpostEast.y },
          ],
          units: [
            { unit: CRAWLER, x: enemyNorth.x, y: enemyNorth.y, count: 12 },
            { unit: SPITTER, x: enemyNorth.x, y: enemyNorth.y, count: 4 },
            { unit: RAIDER, x: enemyEast.x, y: enemyEast.y, count: 6 },
            // Outpost garrisons (M5 batch A; the director takes over
            // refills/retakes in batch C).
            { unit: CRAWLER, x: outpostSouth.x, y: outpostSouth.y, count: 3 },
            { unit: SPITTER, x: outpostSouth.x, y: outpostSouth.y, count: 1 },
            { unit: CRAWLER, x: outpostWest.x, y: outpostWest.y, count: 4 },
            { unit: SPITTER, x: outpostWest.x, y: outpostWest.y, count: 2 },
            { unit: CRAWLER, x: outpostEast.x, y: outpostEast.y, count: 4 },
            { unit: SPITTER, x: outpostEast.x, y: outpostEast.y, count: 2 },
          ],
        },
      },
    ],
    relations: [{ a: toFactionId(1), b: toFactionId(2), relation: 'hostile' }],
  };
}
