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
    id: contentId('frontline_td:crawler'),
    speed: 3.0,
    radius: 0.35,
    movementClass: contentId('frontline_td:ground'),
    hp: 40,
    // Melee: free weapon, no battery (monster).
    weapon: { range: 0.6, damage: 6, cooldown: 1.0, delivery: 'instant' },
    // Low box — the skittering mass.
    visual: { shape: 'box', scale: 0.55 },
  },
  {
    id: contentId('frontline_td:spitter'),
    speed: 2.2,
    radius: 0.3,
    movementClass: contentId('frontline_td:ground'),
    hp: 25,
    weapon: { range: 5, damage: 3, cooldown: 1.2, delivery: 'instant' },
    visual: { shape: 'cone', scale: 0.9 },
  },
  {
    id: contentId('frontline_td:raider'),
    speed: 3.5,
    radius: 0.3,
    movementClass: contentId('frontline_td:ground'),
    hp: 30,
    // Monster raider: free weapon, no battery. Keeps its published id
    // and the logistics interceptor role (ADR 0030).
    weapon: { range: 0.6, damage: 4, cooldown: 0.8, delivery: 'instant' },
    interceptor: { strength: 5000 },
    // Small sphere — the fast infiltrator.
    visual: { shape: 'sphere', scale: 0.75 },
  },
];
