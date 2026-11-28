import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../core/index';
import type { SimClient, SnapshotPair } from './sim-client';

// Minimal pure-JS React hook dispatcher for Node (no DOM globals).
const hookState = {
  refs: [] as { current: unknown }[],
  callbacks: [] as { fn: unknown; deps: readonly unknown[] }[],
  subs: [] as (
    | {
        subscribe: ((cb: () => void) => () => void) | null;
        unsub: (() => void) | null;
        value: unknown;
      }
    | undefined
  )[],
  idx: 0,
  onRerender: () => undefined,
};

function resetHookState(): void {
  for (const s of hookState.subs) {
    s?.unsub?.();
  }
  hookState.refs = [];
  hookState.callbacks = [];
  hookState.subs = [];
  hookState.idx = 0;
  hookState.onRerender = () => undefined;
}

vi.mock('react', () => ({
  useRef: <T>(initial: T): { current: T } => {
    const i = hookState.idx++;
    let cell = hookState.refs[i];
    if (cell === undefined) {
      cell = { current: initial };
      hookState.refs[i] = cell;
    }
    return cell as { current: T };
  },
  useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T => {
    const i = hookState.idx++;
    const prev = hookState.callbacks[i];
    if (
      prev !== undefined &&
      prev.deps.length === deps.length &&
      prev.deps.every((d, k) => Object.is(d, deps[k]))
    ) {
      return prev.fn as T;
    }
    hookState.callbacks[i] = { fn, deps };
    return fn;
  },
  useSyncExternalStore: <T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
  ): T => {
    const i = hookState.idx++;
    let entry = hookState.subs[i];
    if (entry === undefined) {
      entry = { subscribe: null, unsub: null, value: undefined };
      hookState.subs[i] = entry;
    }
    const next = getSnapshot();
    entry.value = next;
    if (entry.subscribe !== subscribe) {
      entry.unsub?.();
      entry.subscribe = subscribe;
      entry.unsub = subscribe(() => {
        const updated = getSnapshot();
        if (!Object.is(entry.value, updated)) {
          entry.value = updated;
          hookState.onRerender();
        }
      });
    }
    return next;
  },
}));

const { subscribeSnapshotClock, useSnapshotValue } = await import('./use-snapshot');

function makeClient(initialTick: number): {
  client: SimClient;
  setTick: (tick: number | null) => void;
  listenerCount: () => number;
} {
  const makeSnap = (t: number): Snapshot => ({
    tick: toTick(t),
    observer: toFactionId(1),
    channels: {},
    events: [],
    layers: {},
    changedLayers: [],
  });
  let pair: SnapshotPair = {
    previous: null,
    latest: makeSnap(initialTick),
    receivedAt: 0,
    intervalMs: 0,
  };
  const listeners = new Set<() => void>();
  const client: SimClient = {
    start: () => undefined,
    restart: () => {
      pair = { previous: null, latest: null, receivedAt: 0, intervalMs: 0 };
      for (const fn of [...listeners]) {
        fn();
      }
    },
    submit: () => undefined,
    setSpeedIndex: () => undefined,
    togglePause: () => undefined,
    snapshots: () => pair,
    inspect: () => undefined,
    inspection: () => null,
    eventsSince: () => ({ events: [], cursor: 0 }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    client,
    listenerCount: () => listeners.size,
    setTick: (nextTick: number | null) => {
      pair =
        nextTick === null
          ? { previous: null, latest: null, receivedAt: 0, intervalMs: 0 }
          : {
              previous: pair.latest,
              latest: makeSnap(nextTick),
              receivedAt: 100,
              intervalMs: 50,
            };
      for (const fn of [...listeners]) {
        fn();
      }
    },
  };
}

describe('subscribeSnapshotClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers zero timers and fires zero callbacks when idle or paused', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { client, listenerCount } = makeClient(1);
    const listener = vi.fn();

    const unsub = subscribeSnapshotClock(client, 100, listener);
    expect(listenerCount()).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();

    unsub();
    expect(listenerCount()).toBe(0);
  });

  it('fires leading edge immediately at t=0, coalesces bursts into one trailing timer, and cleans up', () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { client, setTick, listenerCount } = makeClient(1);
    const { client: otherClient, setTick: setOtherTick } = makeClient(1);

    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();

    const unsubA = subscribeSnapshotClock(client, 100, a);
    const unsubB = subscribeSnapshotClock(client, 100, b);
    const unsubC = subscribeSnapshotClock(otherClient, 100, c);
    expect(listenerCount()).toBe(1);

    // Leading edge at t=0 fires immediately without scheduling a timer.
    setTick(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(0);
    expect(timeoutSpy).toHaveBeenCalledTimes(0);

    // Rapid burst within window schedules a single trailing setTimeout.
    vi.advanceTimersByTime(20);
    setTick(3);
    vi.advanceTimersByTime(20);
    setTick(4);
    expect(a).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);

    // Trailing timer flushes once at the end of the 100 ms window.
    vi.advanceTimersByTime(60);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);

    // Other client is independent.
    setOtherTick(2);
    expect(c).toHaveBeenCalledTimes(1);

    // Unsubscribing one listener leaves bucket and client subscription active.
    unsubA();
    expect(listenerCount()).toBe(1);
    vi.advanceTimersByTime(100);
    setTick(5);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(3);

    // Schedule a pending trailing timer, then unsubscribe last listener -> cancels timer & client sub.
    vi.advanceTimersByTime(10);
    setTick(6);
    unsubB();
    unsubB();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);

    vi.advanceTimersByTime(200);
    expect(b).toHaveBeenCalledTimes(3);

    unsubC();
  });

  it('skips a sibling listener unsubscribed during leading or trailing flush in the same wave', () => {
    const { client, setTick } = makeClient(1);
    const calls: string[] = [];

    // Leading edge: A unsubscribes B before B runs in the same wave.
    let unsubB: () => void = () => undefined;
    const unsubA = subscribeSnapshotClock(client, 100, () => {
      calls.push('A');
      unsubB();
    });
    unsubB = subscribeSnapshotClock(client, 100, () => {
      calls.push('B');
    });

    setTick(2);
    expect(calls).toEqual(['A']);

    unsubA();
    vi.advanceTimersByTime(100);
    calls.length = 0;

    // Trailing flush: trigger leading edge first, then schedule trailing flush
    // where C unsubscribes D before D runs.
    let unsubD: () => void = () => undefined;
    let shouldDropD = false;
    const unsubC = subscribeSnapshotClock(client, 100, () => {
      calls.push('C');
      if (shouldDropD) {
        unsubD();
      }
    });
    unsubD = subscribeSnapshotClock(client, 100, () => {
      calls.push('D');
    });

    // Leading edge at t=0 of this cycle runs both C and D.
    setTick(3);
    expect(calls).toEqual(['C', 'D']);

    // Burst inside the 100 ms window schedules a trailing timer.
    shouldDropD = true;
    vi.advanceTimersByTime(20);
    setTick(4);
    vi.advanceTimersByTime(80);
    expect(calls).toEqual(['C', 'D', 'C']);

    unsubC();
  });
});

describe('useSnapshotValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHookState();
  });

  afterEach(() => {
    resetHookState();
    vi.useRealTimers();
  });

  it('skips re-render when isEqual returns true and re-syncs immediately when client or selector changes', () => {
    const { client: clientA, setTick: setTickA } = makeClient(1);
    const { client: clientB } = makeClient(99);
    const sameBucket = (a: { bucket: number }, b: { bucket: number }): boolean =>
      a.bucket === b.bucket;

    let renders = 0;
    let lastValue: { bucket: number } | undefined;
    let activeClient = clientA;
    let activeSelector = (pair: SnapshotPair): { bucket: number } => ({
      bucket: Math.floor((pair.latest?.tick ?? 0) / 10),
    });

    const render = (): { bucket: number } => {
      hookState.idx = 0;
      renders += 1;
      lastValue = useSnapshotValue(activeClient, activeSelector, sameBucket, 100);
      return lastValue;
    };
    hookState.onRerender = () => {
      render();
    };

    expect(render()).toEqual({ bucket: 0 });
    expect(renders).toBe(1);

    // Tick changes within same bucket -> isEqual holds -> no re-render.
    setTickA(5);
    vi.advanceTimersByTime(100);
    expect(renders).toBe(1);

    // Tick crosses into next bucket -> triggers re-render.
    setTickA(12);
    vi.advanceTimersByTime(100);
    expect(renders).toBe(2);
    expect(lastValue).toEqual({ bucket: 1 });

    // Restart clears latest to null -> triggers re-render.
    clientA.restart({} as Parameters<typeof clientA.restart>[0]);
    expect(renders).toBe(3);
    expect(lastValue).toEqual({ bucket: 0 });

    // Switching client re-syncs immediately during render.
    activeClient = clientB;
    expect(render()).toEqual({ bucket: 9 });

    // Switching selector re-syncs immediately during render.
    activeSelector = (pair: SnapshotPair): { bucket: number } => ({
      bucket: (pair.latest?.tick ?? 0) + 1,
    });
    expect(render()).toEqual({ bucket: 100 });
  });
});
