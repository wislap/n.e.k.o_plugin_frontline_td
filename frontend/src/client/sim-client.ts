// Main-thread client for the sim worker (ADR 0004). Snapshots are kept
// outside React/zustand for later interpolation; only stats and errors reach
// the stores.
import type { EntityHandle, Inspection, Snapshot, Tick } from '../core/index';
import type { MainToWorker, MatchSetup, WorkerToMain } from '../protocol/index';
import { getCapture } from './capture-mode';
import { useRuntimeStore } from './runtime-store';

export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerToMain>) => void): void;
  // Uncaught exception / deserialization failure inside the worker —
  // real Workers surface these on handler properties, not as messages.
  onerror?: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
}

export interface SnapshotPair {
  previous: Snapshot | null;
  latest: Snapshot | null;
  receivedAt: number;
  // Time between the two most recent snapshot receipts (0 until two
  // snapshots have arrived) — the interpolation denominator.
  intervalMs: number;
}

export interface SimClient {
  start(setup: MatchSetup): void;
  // Discards buffered snapshots and restarts the worker sim (play-again).
  restart(setup: MatchSetup): void;
  submit(command: { type: string; payload: unknown }): void;
  setSpeedIndex(index: number): void;
  togglePause(): void;
  snapshots(): SnapshotPair;
  // Selects the entity the worker inspects; null clears the target.
  inspect(handle: EntityHandle | null): void;
  // Latest inspection attached to the most recent snapshot (null = none).
  inspection(): Inspection | null;
  // Events appended since `cursor` (a previous return's cursor, or 0 for
  // the whole retained log). Each consumer keeps its own cursor, so
  // multiple readers can't steal events from each other.
  eventsSince(cursor: number): { events: ClientEvent[]; cursor: number };
}

interface ClientEvent {
  seq: number;
  type: string;
  payload: Snapshot['events'][number]['payload'];
}

// Retained event log cap — oldest entries are dropped past it.
const EVENT_LOG_CAP = 4096;

export function createSimClient(worker: WorkerLike): SimClient {
  // The worker posts layer DELTAS (only changed layers); the client
  // re-completes each snapshot by carrying untouched layers forward from the
  // previous one.
  let previous: Snapshot | null = null;
  let latest: Snapshot | null = null;
  let receivedAt = 0;
  let intervalMs = 0;
  // Capture mode (?capture=): the first snapshot is pinned and the sim is
  // paused at the next processed message; later snapshots/stats are dropped
  // so the rendered tick cannot drift between screenshot runs.
  let pinnedTick: Tick | null = null;
  let latestInspection: Inspection | null = null;
  let eventSeq = 0;
  const eventLog: ClientEvent[] = [];

  // Reported on the console too: the runtime store is UI-optional but
  // a worker crash must never pass silently.
  const report = (message: string): void => {
    console.error('sim worker error:', message);
    useRuntimeStore.getState().setError(message);
  };

  worker.onerror = (event) => {
    report(event.message === '' ? 'sim worker threw an uncaught error' : event.message);
  };
  worker.onmessageerror = () => {
    report('sim worker posted an undeliverable message');
  };

  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.kind === 'snapshot') {
      if (getCapture() !== null) {
        if (pinnedTick !== null) {
          return;
        }
        const incoming = message.snapshot;
        const layers = { ...(latest?.layers ?? {}), ...incoming.layers };
        const completed: Snapshot = { ...incoming, layers };
        latestInspection = message.inspection ?? null;
        previous = completed;
        latest = completed;
        pinnedTick = completed.tick;
        (globalThis as { __ftdCaptureTick?: number }).__ftdCaptureTick = pinnedTick;
        worker.postMessage({ kind: 'set_speed', index: 0 });
        return;
      }
      const incoming = message.snapshot;
      const layers = { ...(latest?.layers ?? {}), ...incoming.layers };
      const completed: Snapshot = { ...incoming, layers };
      for (const e of incoming.events) {
        eventSeq += 1;
        eventLog.push({ seq: eventSeq, type: e.type, payload: e.payload });
      }
      if (eventLog.length > EVENT_LOG_CAP) {
        eventLog.splice(0, eventLog.length - EVENT_LOG_CAP);
      }
      latestInspection = message.inspection ?? null;
      previous = latest;
      latest = completed;
      const now = performance.now();
      intervalMs = receivedAt === 0 ? 0 : now - receivedAt;
      receivedAt = now;
      return;
    }
    if (message.kind === 'stats') {
      const stats =
        pinnedTick !== null
          ? { ...message.stats, tick: pinnedTick, tickRate: 0, paused: true }
          : message.stats;
      useRuntimeStore.getState().setStats(stats);
      return;
    }
    report(message.message);
  });

  return {
    start(setup: MatchSetup): void {
      worker.postMessage({ kind: 'start', setup });
    },
    restart(setup: MatchSetup): void {
      previous = null;
      latest = null;
      receivedAt = 0;
      intervalMs = 0;
      pinnedTick = null;
      latestInspection = null;
      eventSeq = 0;
      eventLog.length = 0;
      worker.postMessage({ kind: 'restart', setup });
    },
    submit(command: { type: string; payload: unknown }): void {
      worker.postMessage({ kind: 'command', command });
    },
    setSpeedIndex(index: number): void {
      worker.postMessage({ kind: 'set_speed', index });
    },
    togglePause(): void {
      worker.postMessage({ kind: 'toggle_pause' });
    },
    snapshots(): SnapshotPair {
      return { previous, latest, receivedAt, intervalMs };
    },
    inspect(handle: EntityHandle | null): void {
      worker.postMessage({ kind: 'inspect', handle });
    },
    inspection(): Inspection | null {
      return latestInspection;
    },
    eventsSince(cursor: number): { events: ClientEvent[]; cursor: number } {
      const first = eventLog.findIndex((e) => e.seq > cursor);
      const events = first === -1 ? [] : eventLog.slice(first);
      return { events, cursor: eventSeq };
    },
  };
}
