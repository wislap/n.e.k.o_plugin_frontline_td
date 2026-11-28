import { afterEach, describe, expect, it, vi } from 'vitest';
import { toFactionId, toTick } from '../core/index';
import type { Snapshot } from '../core/index';
import type { RuntimeStats, WorkerToMain } from '../protocol/index';
import type { CaptureSpec } from './capture-mode';
import { useRuntimeStore } from './runtime-store';
import type { WorkerLike } from './sim-client';

let captureSpec: CaptureSpec | null = null;
vi.mock('./capture-mode', () => ({
  getCapture: () => captureSpec,
}));

const { createSimClient } = await import('./sim-client');

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
    probes: {},
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

  it('surfaces worker onerror and messageerror through the runtime store', () => {
    const worker = fakeWorker();
    createSimClient(worker);
    worker.onerror?.({ message: 'worker exploded' } as ErrorEvent);
    expect(useRuntimeStore.getState().error).toBe('worker exploded');
    worker.onmessageerror?.({} as MessageEvent);
    expect(useRuntimeStore.getState().error).toContain('undeliverable');
  });

  it('eventsSince delivers each event exactly once per cursor', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    const snap = (tick: number, events: Snapshot['events']) => ({
      ...snapshot(tick, {}),
      events,
    });
    const ev = (n: number) => ({ type: 'frontline_td:test.ev', payload: { n } });
    worker.emit({ kind: 'snapshot', snapshot: snap(1, [ev(1), ev(2)]) });
    worker.emit({ kind: 'snapshot', snapshot: snap(2, [ev(3)]) });

    let cursor = 0;
    const first = client.eventsSince(cursor);
    cursor = first.cursor;
    expect(first.events.map((e) => (e.payload as { n: number }).n)).toEqual([1, 2, 3]);
    // Same cursor again: nothing redelivered.
    expect(client.eventsSince(cursor).events).toHaveLength(0);
    // A second consumer with its own cursor sees them independently.
    const other = client.eventsSince(0);
    expect(other.events).toHaveLength(3);

    worker.emit({ kind: 'snapshot', snapshot: snap(3, [ev(4)]) });
    const next = client.eventsSince(cursor);
    expect(next.events.map((e) => (e.payload as { n: number }).n)).toEqual([4]);
  });
});

describe('createSimClient.subscribe', () => {
  afterEach(() => {
    captureSpec = null;
    delete (globalThis as { __ftdCaptureTick?: number }).__ftdCaptureTick;
  });

  it('notifies subscribers after snapshot state updates, not on stats or error', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    const seenTicks: (number | null)[] = [];
    const unsub = client.subscribe(() => {
      seenTicks.push(client.snapshots().latest?.tick ?? null);
    });

    worker.emit({ kind: 'stats', stats: stats(1) });
    worker.emit({ kind: 'error', message: 'oops' });
    expect(seenTicks).toEqual([]);

    worker.emit({ kind: 'snapshot', snapshot: snapshot(10, {}) });
    worker.emit({ kind: 'snapshot', snapshot: snapshot(11, {}) });
    expect(seenTicks).toEqual([10, 11]);

    unsub();
    unsub();
    worker.emit({ kind: 'snapshot', snapshot: snapshot(12, {}) });
    expect(seenTicks).toEqual([10, 11]);
  });

  it('notifies only on capture-mode first pin and clears state before restart notify', () => {
    captureSpec = {
      preset: 'open',
      seed: 1,
      cameraMode: 'spectate',
      interactionMode: 'command',
      center: 'start',
      zoom: null,
    };
    const worker = fakeWorker();
    const client = createSimClient(worker);
    const seen: (number | null)[] = [];
    client.subscribe(() => {
      seen.push(client.snapshots().latest?.tick ?? null);
    });

    worker.emit({ kind: 'snapshot', snapshot: snapshot(5, {}) });
    worker.emit({ kind: 'snapshot', snapshot: snapshot(6, {}) });
    expect(seen).toEqual([5]);

    client.restart({ mapId: 'frontline_td:valley', seed: 2 } as Parameters<
      typeof client.restart
    >[0]);
    expect(seen).toEqual([5, null]);
  });

  it('handles unsubscribe during notification without skipping remaining listeners', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    const calls: string[] = [];
    let unsubA: () => void = () => undefined;
    unsubA = client.subscribe(() => {
      calls.push('A');
      unsubA();
    });
    client.subscribe(() => {
      calls.push('B');
    });

    worker.emit({ kind: 'snapshot', snapshot: snapshot(1, {}) });
    worker.emit({ kind: 'snapshot', snapshot: snapshot(2, {}) });
    expect(calls).toEqual(['A', 'B', 'B']);
  });

  it('does not invoke a sibling listener unsubscribed earlier in the same notification wave', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    const calls: string[] = [];
    let unsubB: () => void = () => undefined;
    client.subscribe(() => {
      calls.push('A');
      unsubB();
    });
    unsubB = client.subscribe(() => {
      calls.push('B');
    });
    client.subscribe(() => {
      calls.push('C');
    });

    worker.emit({ kind: 'snapshot', snapshot: snapshot(1, {}) });
    expect(calls).toEqual(['A', 'C']);

    client.restart({ mapId: 'frontline_td:valley', seed: 1 } as Parameters<
      typeof client.restart
    >[0]);
    expect(calls).toEqual(['A', 'C', 'A', 'C']);
  });
});
