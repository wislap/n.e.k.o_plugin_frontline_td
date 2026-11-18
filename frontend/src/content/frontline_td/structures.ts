// Base-pack structures: main base is the faction warehouse, the station
// is a mid-range relay with the largest vehicle pool, the supply depot
// extends coverage and holds reserves. Miner, power plant and ammo
// factory are the batch-C producers; the turret is the base defence.
import { contentId } from '../../core/index';

export const structures = [
  {
    id: contentId('frontline_td:main_base'),
    vision: 12,
    footprint: { w: 4, h: 4 },
    hp: 1000,
    core: true,
    // Not buildable: start structures only (no `build` block).
    node: { connect: 24, service: 12, vehicles: 20, warehouse: true },
    stores: [
      // Energy generation feeds the warehouse for free via self-attach.
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 500,
        class: 'reserve',
        export: true,
        ratePerSecond: 2,
      },
    ],
    // Refines ore into material while it sits in the warehouse.
    producer: {
      inputs: { 'frontline_td:ore': 1 },
      outputs: { 'frontline_td:material': 1 },
      time: 1,
    },
  },
  {
    id: contentId('frontline_td:station'),
    vision: 6,
    footprint: { w: 2, h: 2 },
    hp: 200,
    build: {
      cost: { 'frontline_td:material': 20 },
      time: 6,
      demolishTime: 3,
      salvageBp: 5000,
    },
    node: { connect: 20, service: 4, vehicles: 8 },
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 400,
        class: 'reserve',
      },
    ],
  },
  {
    id: contentId('frontline_td:supply_depot'),
    vision: 8,
    footprint: { w: 2, h: 2 },
    hp: 300,
    build: {
      cost: { 'frontline_td:material': 30 },
      time: 8,
      demolishTime: 3,
      salvageBp: 5000,
    },
    node: { connect: 10, service: 10, vehicles: 3 },
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 100,
        class: 'reserve',
      },
      {
        cargo: contentId('frontline_td:ammo'),
        capacity: 100,
        class: 'reserve',
      },
    ],
  },
  {
    id: contentId('frontline_td:outpost'),
    vision: 14,
    visionLandmark: true,
    footprint: { w: 3, h: 3 },
    hp: 800,
    // Outposts are never built: they start enemy-owned, become ruins on
    // death and are re-captured into fresh sites (no build cost → the
    // rebuild site is time-only progress).
    node: { connect: 10, service: 10, vehicles: 3 },
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 100,
        class: 'reserve',
      },
      {
        cargo: contentId('frontline_td:ammo'),
        capacity: 100,
        class: 'reserve',
      },
    ],
    exclusion: 12,
    capture: { radius: 4, seconds: 30, rebuildSeconds: 20 },
  },
  {
    id: contentId('frontline_td:miner'),
    vision: 4,
    footprint: { w: 2, h: 2 },
    hp: 250,
    requiresDeposit: contentId('frontline_td:ore'),
    build: {
      cost: { 'frontline_td:material': 15 },
      time: 5,
      demolishTime: 3,
      salvageBp: 5000,
    },
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 10,
        class: 'production',
      },
      {
        cargo: contentId('frontline_td:ore'),
        capacity: 20,
        class: 'production',
        export: true,
      },
    ],
    // 0.2 energy -> 1 ore every 2 s.
    producer: {
      inputs: { 'frontline_td:energy': 0.2 },
      outputs: { 'frontline_td:ore': 1 },
      time: 2,
    },
  },
  {
    id: contentId('frontline_td:power_plant'),
    vision: 4,
    footprint: { w: 3, h: 3 },
    hp: 250,
    build: {
      cost: { 'frontline_td:material': 30 },
      time: 8,
      demolishTime: 3,
      salvageBp: 5000,
    },
    stores: [
      {
        cargo: contentId('frontline_td:ore'),
        capacity: 10,
        class: 'production',
      },
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 50,
        class: 'production',
        export: true,
      },
    ],
    // 1 ore -> 5 energy every 2 s.
    producer: {
      inputs: { 'frontline_td:ore': 1 },
      outputs: { 'frontline_td:energy': 5 },
      time: 2,
    },
  },
  {
    id: contentId('frontline_td:ammo_factory'),
    vision: 4,
    footprint: { w: 3, h: 3 },
    hp: 250,
    build: {
      cost: { 'frontline_td:material': 30 },
      time: 10,
      demolishTime: 3,
      salvageBp: 5000,
    },
    stores: [
      {
        cargo: contentId('frontline_td:material'),
        capacity: 10,
        class: 'production',
      },
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 10,
        class: 'production',
      },
      {
        cargo: contentId('frontline_td:ammo'),
        capacity: 40,
        class: 'production',
        export: true,
      },
    ],
    // 1 material + 1 energy -> 2 ammo every 2 s.
    producer: {
      inputs: { 'frontline_td:material': 1, 'frontline_td:energy': 1 },
      outputs: { 'frontline_td:ammo': 2 },
      time: 2,
    },
  },
  {
    id: contentId('frontline_td:turret'),
    vision: 9,
    footprint: { w: 1, h: 1 },
    hp: 150,
    build: {
      cost: { 'frontline_td:material': 25 },
      time: 6,
      demolishTime: 3,
      salvageBp: 5000,
    },
    stores: [
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 20,
        class: 'lifeline',
        ratePerSecond: -0.1,
      },
      {
        cargo: contentId('frontline_td:ammo'),
        capacity: 60,
        class: 'lifeline',
      },
    ],
    // Kinetic: 8-cell reach, 6 damage every 0.4 s, 1 ammo per shot.
    weapon: {
      range: 8,
      damage: 6,
      cooldown: 0.4,
      delivery: 'instant',
      cost: { cargo: contentId('frontline_td:ammo'), amount: 1 },
    },
  },
  {
    id: contentId('frontline_td:robot_factory'),
    vision: 5,
    footprint: { w: 3, h: 3 },
    hp: 400,
    build: {
      cost: { 'frontline_td:material': 40 },
      time: 10,
      demolishTime: 5,
      salvageBp: 5000,
    },
    stores: [
      {
        cargo: contentId('frontline_td:material'),
        capacity: 20,
        class: 'production',
      },
      {
        cargo: contentId('frontline_td:energy'),
        capacity: 20,
        class: 'production',
      },
    ],
    // 10 material + 10 energy -> 1 robot every 12 s.
    producer: {
      inputs: { 'frontline_td:material': 10, 'frontline_td:energy': 10 },
      unitOutput: [contentId('frontline_td:robot')],
      time: 12,
    },
  },
  {
    id: contentId('frontline_td:hive'),
    vision: 10,
    visionLandmark: true,
    footprint: { w: 4, h: 4 },
    hp: 3000,
    core: true,
    exclusion: 16,
    // Not buildable, no logistics node/stores: a free-running monster
    // spawner (no inputs → no attachment or energy needed).
    producer: {
      inputs: {},
      unitOutput: [
        contentId('frontline_td:crawler'),
        contentId('frontline_td:crawler'),
        contentId('frontline_td:spitter'),
        contentId('frontline_td:crawler'),
        contentId('frontline_td:crawler'),
        contentId('frontline_td:spitter'),
        contentId('frontline_td:raider'),
      ],
      time: 10,
      ramp: [
        { atSeconds: 0, seconds: 10 },
        { atSeconds: 300, seconds: 7 },
        { atSeconds: 600, seconds: 5 },
        { atSeconds: 900, seconds: 4 },
      ],
    },
  },
] as const;
