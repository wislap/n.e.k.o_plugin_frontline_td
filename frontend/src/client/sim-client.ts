// Main-thread client for the sim worker (ADR 0004). Snapshots are kept
// outside React/zustand for later interpolation; only stats and errors reach
// the stores.
import type { Snapshot } from '../core/index';
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
}

export interface SimClient {
  start(setup: MatchSetup): void;
  submit(command: { type: string; payload: unknown }): void;
  setSpeedIndex(index: number): void;
  togglePause(): void;
  snapshots(): SnapshotPair;
}

export function createSimClient(worker: WorkerLike): SimClient {
  // The worker posts layer DELTAS (only changed layers); the client
  // re-completes each snapshot by carrying untouched layers forward from the
  // previous one.
  let previous: Snapshot | null = null;
  let latest: Snapshot | null = null;
  let receivedAt = 0;

  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.kind === 'snapshot') {
      const incoming = message.snapshot;
      const layers = { ...(latest?.layers ?? {}), ...incoming.layers };
      const completed: Snapshot = { ...incoming, layers };
      previous = latest;
      latest = completed;
      receivedAt = performance.now();
      return;
    }
    if (message.kind === 'stats') {
      useRuntimeStore.getState().setStats(message.stats);
      return;
    }
    useRuntimeStore.getState().setError(message.message);
  });

  return {
    start(setup: MatchSetup): void {
      worker.postMessage({ kind: 'start', setup });
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
      return { previous, latest, receivedAt };
    },
  };
}
