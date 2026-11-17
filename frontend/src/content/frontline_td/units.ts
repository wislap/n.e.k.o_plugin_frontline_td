// Base-pack units.
import { contentId } from '../../core/index';
import type { UnitContent } from '../../features/units/content';

export const units: readonly UnitContent[] = [
  {
    id: contentId('frontline_td:robot'),
    speed: 2.5,
    radius: 0.35,
    movementClass: contentId('frontline_td:ground'),
    hp: 50,
    // Lifeline battery: 60 energy, drains 0.05 units/s (upkeep).
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 60,
        class: 'lifeline',
        ratePerSecond: -0.05,
      },
    ],
    // Laser: 5-cell reach, 4 damage every 0.6 s, 0.2 energy per shot.
    weapon: {
      range: 5,
      damage: 4,
      cooldown: 0.6,
      delivery: 'instant',
      cost: { cargo: contentId('frontline_td:energy'), amount: 0.2 },
    },
  },
  {
    id: contentId('frontline_td:raider'),
    speed: 3.5,
    radius: 0.3,
    movementClass: contentId('frontline_td:ground'),
    hp: 30,
    // Battery: 40 energy, drains 0.05 units/s (upkeep).
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 40,
        class: 'lifeline',
        ratePerSecond: -0.05,
      },
    ],
    // Laser: 4-cell reach, 2 damage every 0.8 s, 0.2 energy per shot.
    weapon: {
      range: 4,
      damage: 2,
      cooldown: 0.8,
      delivery: 'instant',
      cost: { cargo: contentId('frontline_td:energy'), amount: 0.2 },
    },
    // Intercepts hostile logistics: halves the quota of links whose
    // corridor the raider sits in.
    interceptor: { strength: 5000 },
  },
];
