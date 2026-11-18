// Main-thread client for the sim worker (ADR 0004). Snapshots are kept
// outside React/zustand for later interpolation; only stats and errors reach
// the stores.
import type { EntityHandle, Inspection, Snapshot } from '../core/index';
import type { MainToWorker, MatchSetup, WorkerToMain } from '../protocol/index';
import { useRuntimeStore } from './runtime-store';

export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerToMain>) => void): void;
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
}

export function createSimClient(worker: WorkerLike): SimClient {
  // The worker posts layer DELTAS (only changed layers); the client
  // re-completes each snapshot by carrying untouched layers forward from the
  // previous one.
  let previous: Snapshot | null = null;
  let latest: Snapshot | null = null;
  let receivedAt = 0;
  let intervalMs = 0;
  let latestInspection: Inspection | null = null;

  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.kind === 'snapshot') {
      const incoming = message.snapshot;
      const layers = { ...(latest?.layers ?? {}), ...incoming.layers };
      const completed: Snapshot = { ...incoming, layers };
      latestInspection = message.inspection ?? null;
      previous = latest;
      latest = completed;
      const now = performance.now();
      intervalMs = receivedAt === 0 ? 0 : now - receivedAt;
      receivedAt = now;
      return;
    }
    if (message.kind === 'stats') {
      useRuntimeStore.getState().setStats(message.stats);
      return;
    }
    // Reported on the console too: the runtime store is UI-optional but
    // a worker crash must never pass silently.
    console.error('sim worker error:', message.message);
    useRuntimeStore.getState().setError(message.message);
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
      latestInspection = null;
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
  };
}
