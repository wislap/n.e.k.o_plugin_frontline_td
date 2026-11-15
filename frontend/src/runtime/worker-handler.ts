// Worker-side message handling and pump (ADR 0004): validates incoming
// message kinds, builds the sim via an injected resolver, and posts snapshot
// deltas plus throttled stats back to the main thread.
import type { FactionId, Snapshot } from '../core/index';
import type { QueuedController, Simulation } from '../kernel/index';
import { parseMatchSetup } from '../protocol/index';
import type { MainToWorker, MatchSetup, WorkerToMain } from '../protocol/index';
import { createSimHost } from './sim-host';
import type { SimHost } from './sim-host';

export interface Resolved {
  sim: Simulation;
  localQueue: QueuedController | null;
  observer: FactionId;
}

type ResolveFn = (setup: MatchSetup) => Resolved | { error: string };

// Minimal worker-scope surface so app/sim-worker.ts can adapt `self` without
// `any` or ts-ignore.
export interface WorkerPort {
  postMessage(message: WorkerToMain): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export interface WorkerHandlerOptions {
  post: (message: WorkerToMain) => void;
  resolve: ResolveFn;
  now: () => number;
}

const STATS_INTERVAL_MS = 250;

export function createWorkerHandler(options: WorkerHandlerOptions): {
  onMessage(msg: unknown): void;
  pump(): void;
} {
  const { post, resolve, now } = options;
  let host: SimHost | null = null;
  let started = false;
  let lastStatsPost = 0;
  // First posted snapshot carries every layer; later posts carry only the
  // union of keys changed since the previous post.
  let firstSnapshotPosted = false;

  function postError(message: string): void {
    post({ kind: 'error', message });
  }

  function postSnapshot(): void {
    if (host === null) {
      return;
    }
    const snapshot = host.latestSnapshot();
    const changed = host.takeChangedLayers();
    const layers: Snapshot['layers'] = {};
    if (!firstSnapshotPosted) {
      for (const [key, layer] of Object.entries(snapshot.layers)) {
        layers[key] = layer.slice();
      }
      firstSnapshotPosted = true;
    } else {
      for (const key of changed) {
        const layer = snapshot.layers[key];
        if (layer !== undefined) {
          layers[key] = layer.slice();
        }
      }
    }
    post({ kind: 'snapshot', snapshot: { ...snapshot, layers } });
  }

  function onStart(setup: unknown): void {
    if (started) {
      postError('received a second start message');
      return;
    }
    const parsed = parseMatchSetup(setup);
    if (!parsed.ok) {
      postError(`invalid match setup: ${parsed.errors.join('; ')}`);
      return;
    }
    const resolved = resolve(parsed.setup);
    if ('error' in resolved) {
      postError(resolved.error);
      return;
    }
    started = true;
    host = createSimHost({
      sim: resolved.sim,
      localQueue: resolved.localQueue,
      observer: resolved.observer,
    });
  }

  return {
    onMessage(msg: unknown): void {
      if (typeof msg !== 'object' || msg === null || !('kind' in msg)) {
        postError('malformed worker message');
        return;
      }
      const message = msg as MainToWorker;
      switch (message.kind) {
        case 'start':
          onStart(message.setup);
          return;
        case 'command':
          if (host === null) {
            postError('command before start');
            return;
          }
          try {
            host.submitLocal(message.command);
          } catch (error) {
            postError(error instanceof Error ? error.message : String(error));
          }
          return;
        case 'set_speed':
          if (host === null) {
            postError('set_speed before start');
            return;
          }
          try {
            host.setSpeedIndex(message.index);
          } catch (error) {
            postError(error instanceof Error ? error.message : String(error));
          }
          return;
        case 'toggle_pause':
          if (host === null) {
            postError('toggle_pause before start');
            return;
          }
          host.togglePause();
          return;
        default:
          postError('unknown worker message kind');
      }
    },

    pump(): void {
      if (host === null) {
        return;
      }
      const ran = host.advance(now());
      if (ran > 0) {
        postSnapshot();
      }
      const nowMs = now();
      if (nowMs - lastStatsPost >= STATS_INTERVAL_MS) {
        lastStatsPost = nowMs;
        post({ kind: 'stats', stats: host.stats(nowMs) });
      }
    },
  };
}
