import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInteractionStore } from '../client/interaction-store';
import { useSelectionStore } from '../client/selection-store';
import { resetClientState } from '../client/session';
import type { SimClient, SnapshotPair } from '../client/sim-client';
import { toFactionId, toTick, type Snapshot } from '../core/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  StructuresChannel,
} from '../features/construction/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import { pruneSelectionFromSnapshot, subscribeSelectionPruning } from './selection-pruning';

function makeSnapshot(channels: Snapshot['channels']): Snapshot {
  return {
    tick: toTick(1),
    observer: toFactionId(1),
    channels,
    events: [],
    layers: {},
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
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
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

describe('selection pruning', () => {
  beforeEach(() => {
    resetClientState();
  });

  it('fast-paths when selection is empty without replacing the Set reference', () => {
    const before = useSelectionStore.getState().selected;
    pruneSelectionFromSnapshot(makeSnapshot({}));
    expect(useSelectionStore.getState().selected).toBe(before);
  });

  it('keeps valid handles across units, structures, salvage, and road segments with reference identity', () => {
    useSelectionStore.getState().setSelection(new Set([10, 20, 30, 40]), false);
    const before = useSelectionStore.getState().selected;

    pruneSelectionFromSnapshot(
      makeSnapshot({
        [DenseUnitsChannel.id]: { handles: new Float64Array([10]) },
        [StructuresChannel.id]: { handles: new Float64Array([20]) },
        [SalvageChannel.id]: { handles: new Float64Array([30]) },
        [RoadWorksChannel.id]: { segments: { handles: new Float64Array([40]) } },
      }),
    );

    expect(useSelectionStore.getState().selected).toBe(before);
  });

  it('prunes missing handles, clears demolishConfirm via store subscription, and stops after unsubscribe', () => {
    useSelectionStore.getState().setSelection(new Set([10, 20, 99]), false);
    useInteractionStore.getState().armDemolishConfirm([20], 1000);

    const { client, push } = makeFakeClient(
      makeSnapshot({
        [DenseUnitsChannel.id]: { handles: new Float64Array([10]) },
        [StructuresChannel.id]: { handles: new Float64Array([20]) },
      }),
    );

    const unsub = subscribeSelectionPruning(client);
    expect([...useSelectionStore.getState().selected]).toEqual([10, 20]);
    expect(useInteractionStore.getState().demolishConfirm).toBeNull();

    // Restart (snapshot === null) clears selection.
    client.restart({} as Parameters<typeof client.restart>[0]);
    expect(useSelectionStore.getState().selected.size).toBe(0);

    // Unsubscribe stops future pruning.
    unsub();
    useSelectionStore.getState().setSelection(new Set([55]), false);
    push(makeSnapshot({}));
    expect([...useSelectionStore.getState().selected]).toEqual([55]);
  });
});
