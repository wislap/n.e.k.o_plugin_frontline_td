// Shared event-driven snapshot coalescer and React selector hook
// (ADR 0004, ADR 0048): panels share a leading+trailing coalescer per
// (SimClient, intervalMs) backed by SimClient.subscribe — zero timers
// and zero callbacks while paused — and avoid re-rendering when the
// derived slice satisfies isEqual.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { SimClient, SnapshotPair } from './sim-client';

interface ClockBucket {
  listeners: Set<() => void>;
  unsubClient: () => void;
  lastFiredAt: number;
  timerId: ReturnType<typeof setTimeout> | null;
}

const clocks = new WeakMap<SimClient, Map<number, ClockBucket>>();

export function subscribeSnapshotClock(
  client: SimClient,
  intervalMs: number,
  listener: () => void,
): () => void {
  let byInterval = clocks.get(client);
  if (byInterval === undefined) {
    byInterval = new Map();
    clocks.set(client, byInterval);
  }
  let bucket = byInterval.get(intervalMs);
  if (bucket === undefined) {
    const listeners = new Set<() => void>();
    const activeBucket: ClockBucket = {
      listeners,
      unsubClient: () => undefined,
      lastFiredAt: -Infinity,
      timerId: null,
    };
    const fire = (): void => {
      activeBucket.lastFiredAt = performance.now();
      for (const fn of [...listeners]) {
        if (listeners.has(fn)) {
          fn();
        }
      }
    };
    const onClientChange = (): void => {
      const now = performance.now();
      const elapsed = now - activeBucket.lastFiredAt;
      if (elapsed >= intervalMs) {
        if (activeBucket.timerId !== null) {
          clearTimeout(activeBucket.timerId);
          activeBucket.timerId = null;
        }
        fire();
      } else if (activeBucket.timerId === null) {
        const waitMs = Math.max(0, intervalMs - elapsed);
        activeBucket.timerId = setTimeout(() => {
          activeBucket.timerId = null;
          fire();
        }, waitMs);
      }
    };
    activeBucket.unsubClient = client.subscribe(onClientChange);
    bucket = activeBucket;
    byInterval.set(intervalMs, bucket);
  }
  bucket.listeners.add(listener);
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    bucket.listeners.delete(listener);
    if (bucket.listeners.size === 0) {
      if (bucket.timerId !== null) {
        clearTimeout(bucket.timerId);
        bucket.timerId = null;
      }
      bucket.unsubClient();
      byInterval.delete(intervalMs);
      if (byInterval.size === 0) {
        clocks.delete(client);
      }
    }
  };
}

type SnapshotCache<T> = { hasValue: false } | { hasValue: true; value: T };

export function useSnapshotValue<T>(
  client: SimClient,
  selector: (pair: SnapshotPair) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  intervalMs: number = 100,
): T {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeSnapshotClock(client, intervalMs, onStoreChange),
    [client, intervalMs],
  );
  const cacheRef = useRef<SnapshotCache<T>>({ hasValue: false });
  const getSnapshot = useCallback((): T => {
    const next = selector(client.snapshots());
    const cached = cacheRef.current;
    if (cached.hasValue && isEqual(cached.value, next)) {
      return cached.value;
    }
    cacheRef.current = { hasValue: true, value: next };
    return next;
  }, [client, selector, isEqual]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
