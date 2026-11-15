import { describe, expect, it } from 'vitest';
import { toFactionId, toTick } from '../core/index';
import type { Snapshot } from '../core/index';
import type { RuntimeStats, WorkerToMain } from '../protocol/index';
import { useRuntimeStore } from './runtime-store';
import { createSimClient } from './sim-client';
import type { WorkerLike } from './sim-client';

function snapshot(tick: number, layers: Snapshot['layers']): Snapshot {
  return {
    tick: toTick(tick),
    observer: toFactionId(1),
    channels: {},
    events: [],
    layers,
    changedLayers: Object.keys(layers),
  };
}

function stats(tick: number): RuntimeStats {
  return {
    tick: toTick(tick),
    speedIndex: 1,
    paused: false,
    tickRate: 20,
    entityCount: 0,
    systems: [],
  };
}

function fakeWorker(): WorkerLike & { emit(message: WorkerToMain): void } {
  let listener: ((event: MessageEvent<WorkerToMain>) => void) | null = null;
  return {
    postMessage: () => undefined,
    addEventListener: (_type, cb) => {
      listener = cb;
    },
    emit(message) {
      listener?.({ data: message } as MessageEvent<WorkerToMain>);
    },
  };
}

describe('createSimClient', () => {
  it('rotates previous/latest snapshots', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    worker.emit({ kind: 'snapshot', snapshot: snapshot(1, { a: new Uint8Array([1]) }) });
    worker.emit({ kind: 'snapshot', snapshot: snapshot(2, { a: new Uint8Array([2]) }) });
    const pair = client.snapshots();
    expect(pair.previous?.tick).toBe(1);
    expect(pair.latest?.tick).toBe(2);
    expect(pair.receivedAt).toBeGreaterThanOrEqual(0);
  });

  it('carries missing delta layers forward from the previous snapshot', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    worker.emit({
      kind: 'snapshot',
      snapshot: snapshot(1, { a: new Uint8Array([1]), b: new Int32Array([5]) }),
    });
    // Delta: only 'a' changed.
    const delta = snapshot(2, { a: new Uint8Array([9]) });
    worker.emit({ kind: 'snapshot', snapshot: delta });
    const layers = client.snapshots().latest?.layers ?? {};
    expect(layers['a']).toEqual(new Uint8Array([9]));
    expect(layers['b']).toEqual(new Int32Array([5]));
  });

  it('routes stats into the runtime store', () => {
    const worker = fakeWorker();
    createSimClient(worker);
    worker.emit({ kind: 'stats', stats: stats(4) });
    expect(useRuntimeStore.getState().stats?.tick).toBe(4);
  });

  it('routes errors into the runtime store', () => {
    const worker = fakeWorker();
    createSimClient(worker);
    worker.emit({ kind: 'error', message: 'boom' });
    expect(useRuntimeStore.getState().error).toBe('boom');
  });
});
