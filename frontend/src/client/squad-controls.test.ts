import { describe, expect, it } from 'vitest';
import type { SquadView } from '../features/squads/protocol';
import {
  digitForTag,
  digitPress,
  playerSquadTag,
  routeMoveSelection,
  squadForDigit,
} from './squad-controls';

function squad(over: Partial<SquadView>): SquadView {
  return {
    id: 0,
    faction: 1,
    memberCount: 3,
    strength: 8,
    order: { kind: 'idle', x: 0, y: 0, radius: 4 },
    phase: 'holding',
    centroid: { x: 0, y: 0 },
    ...over,
  };
}

describe('player squad tags', () => {
  it('round-trips digits 1..9', () => {
    for (let d = 1; d <= 9; d++) {
      expect(digitForTag(playerSquadTag(d))).toBe(d);
    }
  });

  it('rejects non-player and out-of-range tags', () => {
    expect(digitForTag(undefined)).toBeNull();
    expect(digitForTag('hive_guard')).toBeNull();
    expect(digitForTag('wave:3')).toBeNull();
    expect(digitForTag('player:0')).toBeNull();
    expect(digitForTag('player:12')).toBeNull();
  });

  it('squadForDigit only matches the observer faction', () => {
    const squads = [
      squad({ id: 1, faction: 1, tag: 'player:2' }),
      squad({ id: 2, faction: 2, tag: 'player:2' }),
      squad({ id: 3, faction: 1, tag: 'hive_guard' }),
    ];
    expect(squadForDigit(squads, 1, 2)?.id).toBe(1);
    expect(squadForDigit(squads, 1, 5)).toBeUndefined();
  });
});

describe('routeMoveSelection', () => {
  const squads = [
    squad({ id: 7, faction: 1, members: [11, 12, 13] }),
    squad({ id: 8, faction: 1, members: [21, 22] }),
    // Hostile squads expose no members and must be ignored.
    squad({ id: 9, faction: 2 }),
  ];

  it('orders every squad with ≥1 selected member as a whole', () => {
    const r = routeMoveSelection([12, 21, 30], squads, 1);
    expect(r.squads).toEqual([7, 8]);
    expect(r.plain).toEqual([30]);
  });

  it('leaves fully-squadded selections with no plain move', () => {
    const r = routeMoveSelection([11, 13], squads, 1);
    expect(r.squads).toEqual([7]);
    expect(r.plain).toEqual([]);
  });

  it('sends everything to plain move when no squad is selected', () => {
    const r = routeMoveSelection([40, 41], squads, 1);
    expect(r.squads).toEqual([]);
    expect(r.plain).toEqual([40, 41]);
  });
});

describe('digitPress', () => {
  it('selects on the first press and centres on a fast repeat', () => {
    let last = null;
    let r = digitPress(last, 3, 1000);
    expect(r.action).toBe('select');
    last = r.last;
    r = digitPress(last, 3, 1300);
    expect(r.action).toBe('center');
  });

  it('selects again after the window or a different digit', () => {
    const a = digitPress(null, 3, 0);
    expect(digitPress(a.last, 3, 500).action).toBe('select');
    expect(digitPress(a.last, 4, 100).action).toBe('select');
  });
});
