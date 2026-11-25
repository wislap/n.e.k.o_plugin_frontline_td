import { describe, expect, it, vi } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { MoveCommand } from '../../movement/protocol';
import { SquadsChannel, SquadsOrder, type SquadView } from '../protocol';
import type { SimClient } from '../../../client/sim-client';
import {
  digitForTag,
  digitPress,
  playerSquadTag,
  routeMoveSelection,
  squadForDigit,
  submitMoveOrder,
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

describe('submitMoveOrder', () => {
  function fakeClient(): { client: SimClient; submitted: { type: string; payload: unknown }[] } {
    const submitted: { type: string; payload: unknown }[] = [];
    const client: SimClient = {
      start: vi.fn(),
      restart: vi.fn(),
      submit: (cmd) => {
        submitted.push(cmd);
      },
      setSpeedIndex: vi.fn(),
      togglePause: vi.fn(),
      snapshots: () => ({ previous: null, latest: null, receivedAt: 0, intervalMs: 0 }),
      inspect: vi.fn(),
      inspection: () => null,
      eventsSince: () => ({ events: [], cursor: 0 }),
    };
    return { client, submitted };
  }

  it('submits SquadsOrder for covered squads and MoveCommand for plain units', () => {
    const { client, submitted } = fakeClient();
    const snapshot: Snapshot = {
      tick: toTick(1),
      observer: toFactionId(1),
      channels: {
        [SquadsChannel.id]: {
          squads: [squad({ id: 7, faction: 1, members: [11, 12] })],
        },
      },
      events: [],
      layers: {},
      changedLayers: [],
    };

    submitMoveOrder(client, snapshot, [11, 30], 12.8, 7.2, true);
    expect(submitted).toEqual([
      {
        type: SquadsOrder.type,
        payload: { squad: 7, kind: 'guard', x: 12, y: 7 },
      },
      {
        type: MoveCommand.type,
        payload: { units: [30], x: 12, y: 7 },
      },
    ]);
  });

  it('uses advance when guard is false and falls back to plain MoveCommand when snapshot is null', () => {
    const { client, submitted } = fakeClient();
    submitMoveOrder(client, null, [5, 6], 4.1, 9.9, false);
    expect(submitted).toEqual([
      {
        type: MoveCommand.type,
        payload: { units: [5, 6], x: 4, y: 9 },
      },
    ]);
  });

  it('does nothing when selection is empty', () => {
    const { client, submitted } = fakeClient();
    submitMoveOrder(client, null, [], 4, 5, false);
    expect(submitted).toEqual([]);
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
