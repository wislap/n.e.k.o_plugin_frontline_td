import { describe, expect, it } from 'vitest';
import { defineSnapshotChannel, readChannel, readLayer } from './messages';
import type { Snapshot } from './messages';
import { toFactionId } from './faction';
import { toTick } from './time';

const Chan = defineSnapshotChannel<{ total: number }>('test:channel');

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: toTick(0),
    observer: toFactionId(0),
    channels: {},
    events: [],
    layers: {},
    changedLayers: [],
    ...overrides,
  };
}

describe('readChannel', () => {
  it('returns the typed channel value', () => {
    const snap = snapshot({ channels: { [Chan.id]: { total: 7 } } });
    expect(readChannel(snap, Chan)).toEqual({ total: 7 });
  });

  it('returns null for missing, null or undefined snapshots', () => {
    expect(readChannel(snapshot(), Chan)).toBeNull();
    expect(readChannel(null, Chan)).toBeNull();
    expect(readChannel(undefined, Chan)).toBeNull();
  });
});

describe('readLayer', () => {
  it('returns the typed layer array', () => {
    const data = new Uint8Array([1, 2, 3]);
    const snap = snapshot({ layers: { 'test:layer': data } });
    expect(readLayer(snap, 'test:layer')).toBe(data);
    expect(readLayer(snap, 'test:layer')).toBe(data);
  });

  it('returns null for missing, null or undefined snapshots', () => {
    expect(readLayer(snapshot(), 'test:layer')).toBeNull();
    expect(readLayer(null, 'test:layer')).toBeNull();
    expect(readLayer(undefined, 'test:layer')).toBeNull();
  });
});
