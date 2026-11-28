import { describe, expect, it } from 'vitest';
import { defineSnapshotChannel, TICK_MS, toFactionId, toTick, type Snapshot } from '../core/index';
import type { SnapshotPair } from './sim-client';
import {
  ChannelPositionInterpolator,
  interpAlpha,
  interpolateChannelEntities,
  lerp,
  type FactionPositionedChannel,
} from './interpolate';

const TestChannel = defineSnapshotChannel<FactionPositionedChannel>('test:entities');

function makeSnap(
  tick: number,
  rows: readonly { handle: number; x: number; y: number; faction: number }[],
): Snapshot {
  return {
    tick: toTick(tick),
    observer: toFactionId(1),
    channels: {
      [TestChannel.id]: {
        handles: Float64Array.from(rows.map((r) => r.handle)),
        x: Float32Array.from(rows.map((r) => r.x)),
        y: Float32Array.from(rows.map((r) => r.y)),
        faction: Uint16Array.from(rows.map((r) => r.faction)),
      },
    },
    events: [],
    layers: {},
    changedLayers: [],
  };
}

describe('interpAlpha', () => {
  it('clamps to [0, 1]', () => {
    expect(interpAlpha(0, 100, 50)).toBe(0);
    expect(interpAlpha(200, 100, 50)).toBe(1);
    expect(interpAlpha(125, 100, 50)).toBeCloseTo(0.5, 6);
  });

  it('falls back to TICK_MS when no interval has been measured', () => {
    expect(interpAlpha(100 + TICK_MS / 2, 100, 0)).toBeCloseTo(0.5, 6);
    expect(interpAlpha(110, 100, -5, 20)).toBeCloseTo(0.5, 6);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(2, 6, 0.25)).toBeCloseTo(3, 6);
  });
});

describe('ChannelPositionInterpolator', () => {
  it('interpolates matching handles and places newly spawned entities at latest position', () => {
    const interp = new ChannelPositionInterpolator(TestChannel);
    const prev = makeSnap(1, [{ handle: 10, x: 2, y: 4, faction: 1 }]);
    const latest = makeSnap(2, [
      { handle: 10, x: 6, y: 8, faction: 1 },
      { handle: 20, x: 12, y: 15, faction: 2 },
    ]);
    const pair: SnapshotPair = { latest, previous: prev, receivedAt: 100, intervalMs: 50 };

    const channel = interp.update(pair);
    expect(interp.prevSnapshotChanged).toBe(true);
    expect(channel).not.toBeNull();
    if (channel !== null) {
      expect(interp.interpolated(channel, 0, 0.5)).toEqual({ x: 4, y: 6 });
      expect(interp.interpolated(channel, 1, 0.5)).toEqual({ x: 12, y: 15 });
    }

    // Re-calling update with the same latest snapshot keeps prevSnapshotChanged false.
    interp.update(pair);
    expect(interp.prevSnapshotChanged).toBe(false);
  });

  it('returns null when latest snapshot has no matching channel', () => {
    const interp = new ChannelPositionInterpolator(TestChannel);
    const pair: SnapshotPair = { latest: null, previous: null, receivedAt: 0, intervalMs: 50 };
    expect(interp.update(pair)).toBeNull();
  });
});

describe('interpolateChannelEntities', () => {
  it('returns an interpolated handle map using pair timing and preserves faction', () => {
    const prev = makeSnap(1, [{ handle: 10, x: 0, y: 10, faction: 1 }]);
    const latest = makeSnap(2, [
      { handle: 10, x: 10, y: 20, faction: 1 },
      { handle: 20, x: 3, y: 5, faction: 2 },
    ]);
    const pair: SnapshotPair = { latest, previous: prev, receivedAt: 100, intervalMs: 50 };

    const map = interpolateChannelEntities(TestChannel, pair, 125);
    expect(map.size).toBe(2);
    expect(map.get(10)).toEqual({ x: 5, y: 15, faction: 1 });
    expect(map.get(20)).toEqual({ x: 3, y: 5, faction: 2 });
  });

  it('returns an empty map when latest snapshot is null', () => {
    const pair: SnapshotPair = { latest: null, previous: null, receivedAt: 0, intervalMs: 50 };
    expect(interpolateChannelEntities(TestChannel, pair, 50).size).toBe(0);
  });
});
