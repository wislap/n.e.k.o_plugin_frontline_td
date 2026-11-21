// Shared snapshot polling clock and React selector hook (ADR 0004,
// ADR 0048): panels share a single setInterval per (SimClient, intervalMs)
// and avoid re-rendering when the derived slice satisfies isEqual.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { SimClient, SnapshotPair } from './sim-client';

interface ClockBucket {
  listeners: Set<() => void>;
  id: ReturnType<typeof setInterval>;
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
    const id = setInterval(() => {
      for (const fn of [...listeners]) {
        fn();
      }
    }, intervalMs);
    bucket = { listeners, id };
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
      clearInterval(bucket.id);
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
