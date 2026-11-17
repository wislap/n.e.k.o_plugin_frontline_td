import { describe, expect, it } from 'vitest';
import type { SquadView } from '../protocol';
import {
  arrowSpots,
  bannerThreat,
  gatheringThreats,
  routedThreats,
  routePoints,
} from './threat-info';

function squad(over: Partial<SquadView>): SquadView {
  return {
    id: 0,
    faction: 2,
    memberCount: 5,
    strength: 8,
    order: { kind: 'idle', x: 0, y: 0, radius: 4 },
    phase: 'holding',
    centroid: { x: 0, y: 0 },
    ...over,
  };
}

describe('gatheringThreats / routedThreats', () => {
  const squads = [
    squad({ id: 1, order: { kind: 'gather', x: 10, y: 10, radius: 4, launchTick: 500 } }),
    squad({ id: 2, order: { kind: 'advance', x: 0, y: 0, radius: 4 }, route: [0, 0, 1, 1] }),
    squad({ id: 3, faction: 1, order: { kind: 'gather', x: 5, y: 5, radius: 4 } }),
  ];

  it('finds only hostile gathers', () => {
    expect(gatheringThreats(squads, 1).map((s) => s.id)).toEqual([1]);
  });

  it('exposes routes for gathers and advancing waves only', () => {
    expect(routedThreats(squads, 1).map((s) => s.id)).toEqual([2]);
  });
});

describe('route helpers', () => {
  it('routePoints pairs flat coordinates', () => {
    expect(routePoints([1, 2, 3, 4, 5])).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('arrowSpots samples every Nth waypoint toward the next', () => {
    const route = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0];
    const spots = arrowSpots(route, 2);
    expect(spots).toEqual([
      { x: 0, y: 0, dx: 2, dy: 0 },
      { x: 2, y: 0, dx: 2, dy: 0 },
    ]);
  });
});

describe('bannerThreat', () => {
  it('summarises the biggest gather and the soonest launch', () => {
    const squads = [
      squad({
        id: 1,
        memberCount: 8,
        order: { kind: 'gather', x: 0, y: 0, radius: 4, launchTick: 400 },
      }),
      squad({
        id: 2,
        memberCount: 3,
        order: { kind: 'gather', x: 0, y: 0, radius: 4, launchTick: 300 },
      }),
    ];
    expect(bannerThreat(squads, 1, 100)).toEqual({ count: 8, ticksLeft: 200 });
  });

  it('is null without a hostile gather', () => {
    expect(bannerThreat([squad({ id: 1, faction: 1 })], 1, 0)).toBeNull();
  });
});
