import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cursorState } from '../../../client/cursor';
import { useInteractionStore } from '../../../client/interaction-store';
import { resetClientState } from '../../../client/session';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { loadContent } from '../../../content/index';
import { proto01 } from '../../../content/frontline_td/maps/proto_01';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import { SERVICE_LAYER_ID } from '../../logistics/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../../terrain/protocol';
import { computeGhostState, subscribeGhostSync } from './ghost-sync';

const db = loadContent();
const mapOrUndef = db.maps.byId(proto01.id);
if (mapOrUndef === undefined) {
  throw new Error('proto_01 missing');
}
const map = mapOrUndef;
const OBSERVER = 1;
const isHostile = (observer: number, faction: number): boolean =>
  faction !== 0 && faction !== observer;

function snapshotWith(layers: Snapshot['layers'] = {}): Snapshot {
  return {
    tick: toTick(1),
    observer: toFactionId(OBSERVER),
    channels: {},
    events: [],
    layers: {
      [TERRAIN_HEIGHT_LAYER_ID]: map.grid.heights,
      [TERRAIN_SURFACE_LAYER_ID]: map.grid.surfaces,
      ...layers,
    },
    changedLayers: [],
  };
}

function makeFakeClient(initial: Snapshot | null = null): {
  client: SimClient;
  push: (next: Snapshot | null) => void;
} {
  let latest = initial;
  const listeners = new Set<() => void>();
  const client: SimClient = {
    start: vi.fn(),
    restart: () => {
      latest = null;
      for (const fn of [...listeners]) {
        fn();
      }
    },
    submit: vi.fn(),
    setSpeedIndex: vi.fn(),
    togglePause: vi.fn(),
    snapshots: (): SnapshotPair => ({ previous: null, latest, receivedAt: 0, intervalMs: 0 }),
    inspect: vi.fn(),
    inspection: () => null,
    eventsSince: () => ({ events: [], cursor: 0 }),
    subscribe: (fn) => {
      listeners.add(listenerWrap(fn));
      return () => {
        listeners.delete(listenerWrap(fn));
      };
    },
  };
  function listenerWrap(fn: () => void): () => void {
    return fn;
  }
  return {
    client,
    push: (next) => {
      latest = next;
      for (const fn of [...listeners]) {
        fn();
      }
    },
  };
}

describe('computeGhostState & subscribeGhostSync', () => {
  beforeEach(() => {
    resetClientState();
  });

  afterEach(() => {
    resetClientState();
  });

  it('returns null when tool is not place, snapshot is null, ground is invalid, or kind is unknown', () => {
    const snap = snapshotWith();
    expect(
      computeGhostState(db, map, isHostile, { kind: 'none' }, snap, { x: 20, y: 40, valid: true }),
    ).toBeNull();
    expect(
      computeGhostState(
        db,
        map,
        isHostile,
        { kind: 'place', structureKindId: 'frontline_td:supply_depot' },
        null,
        { x: 20, y: 40, valid: true },
      ),
    ).toBeNull();
    expect(
      computeGhostState(
        db,
        map,
        isHostile,
        { kind: 'place', structureKindId: 'frontline_td:supply_depot' },
        snap,
        { x: 20, y: 40, valid: false },
      ),
    ).toBeNull();
    expect(
      computeGhostState(
        db,
        map,
        isHostile,
        { kind: 'place', structureKindId: 'frontline_td:unknown_kind' },
        snap,
        { x: 20, y: 40, valid: true },
      ),
    ).toBeNull();
  });

  it('skips redundant setGhost updates within the same centered footprint cell', () => {
    const { client } = makeFakeClient(snapshotWith());
    const unsub = subscribeGhostSync({ client, db, map, isHostile });

    useInteractionStore.getState().enterPlace('frontline_td:turret');
    cursorState.setGround({ x: 20.1, y: 40.1 });
    const firstGhost = useInteractionStore.getState().ghost;
    expect(firstGhost).not.toBeNull();

    // Moving within the same cell preserves the ghost reference.
    cursorState.setGround({ x: 20.4, y: 40.4 });
    expect(useInteractionStore.getState().ghost).toBe(firstGhost);

    unsub();
  });

  it('fixes the lastGhost stale-cache bug when leaving/re-entering the same cell or switching kinds', () => {
    const { client } = makeFakeClient(snapshotWith());
    const unsub = subscribeGhostSync({ client, db, map, isHostile });

    // Enter place at an unconnected cell -> depot (node) reports 'not_connected'.
    useInteractionStore.getState().enterPlace('frontline_td:supply_depot');
    cursorState.setGround({ x: 20.5, y: 40.5 });
    const initial = useInteractionStore.getState().ghost;
    expect(initial).toEqual({ x: 19, y: 39, code: 'not_connected' });

    // Leave the map / canvas -> clears ghost to null.
    cursorState.setGround(null);
    expect(useInteractionStore.getState().ghost).toBeNull();

    // Re-enter the exact same cell -> ghost must be restored (old lastGhost cache skipped this!).
    cursorState.setGround({ x: 20.5, y: 40.5 });
    expect(useInteractionStore.getState().ghost).toEqual({ x: 19, y: 39, code: 'not_connected' });

    // Switch to another structure kind at the same cell -> updates immediately.
    useInteractionStore.getState().enterPlace('frontline_td:turret');
    expect(useInteractionStore.getState().ghost).toEqual({ x: 20, y: 40, code: 'not_covered' });

    unsub();
  });

  it('re-evaluates on snapshot updates, clears on restart, and stops after unsubscribe', () => {
    const { client, push } = makeFakeClient(snapshotWith());
    const unsub = subscribeGhostSync({ client, db, map, isHostile });

    useInteractionStore.getState().enterPlace('frontline_td:turret');
    cursorState.setGround({ x: 20.2, y: 40.2 });
    expect(useInteractionStore.getState().ghost).toEqual({ x: 19, y: 39, code: 'not_covered' });

    // Coverage arrives in a new snapshot -> transitions to 'ok'.
    const service = new Uint8Array(map.grid.width * map.grid.height);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        service[(39 + dy) * map.grid.width + (19 + dx)] = 1;
      }
    }
    push(snapshotWith({ [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service }));
    expect(useInteractionStore.getState().ghost).toEqual({ x: 19, y: 39, code: 'ok' });

    // Restart clears snapshot -> ghost becomes null.
    client.restart({} as Parameters<typeof client.restart>[0]);
    expect(useInteractionStore.getState().ghost).toBeNull();

    // After unsubscribe, future updates no longer mutate ghost.
    unsub();
    push(snapshotWith({ [`${SERVICE_LAYER_ID}#${OBSERVER}`]: service }));
    expect(useInteractionStore.getState().ghost).toBeNull();
  });
});
