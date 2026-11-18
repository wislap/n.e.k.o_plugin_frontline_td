// Worker-side message handling and pump (ADR 0004): validates incoming
// message kinds, builds the sim via an injected resolver, and posts snapshot
// deltas plus throttled stats back to the main thread.
import type { EntityHandle, FactionId, Snapshot } from '../core/index';
import type { QueuedController, SimConfig, SimModule, Simulation } from '../kernel/index';
import { parseMatchSetup } from '../protocol/index';
import type { MainToWorker, MatchSetup, WorkerToMain } from '../protocol/index';
import { createSimHost } from './sim-host';
import type { SimHost } from './sim-host';

export interface Resolved {
  sim: Simulation;
  localQueue: QueuedController | null;
  observer: FactionId;
  // The exact config/modules the sim was built with — needed to restore
  // a serialized sim (restoreSimulation takes the same pair).
  config: SimConfig;
  modules: SimModule[];
  // When provided, the host stops stepping once this reports true
  // (clock frozen; pause/speed ignored). Mode-supplied.
  ended?: () => boolean;
}

type ResolveFn = (setup: MatchSetup) => Resolved | { error: string };

// Minimal worker-scope surface so app/sim-worker.ts can adapt `self` without
// `any` or ts-ignore.
export interface WorkerPort {
  postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export interface WorkerHandlerOptions {
  post: (message: WorkerToMain, transfer?: Transferable[]) => void;
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
  // A pump exception crashes the match: stop advancing and report once
  // instead of throwing on every interval tick.
  let crashed = false;
  let lastStatsPost = 0;
  // Current inspect target; attached to every posted snapshot.
  let inspectHandle: EntityHandle | null = null;
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
    // Events since the previous post (the kernel snapshot only carries
    // the last tick's; multi-tick runs must not lose the earlier ones).
    const events = host.takeEvents();
    const layers: Snapshot['layers'] = {};
    const transfer: Transferable[] = [];
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
    for (const layer of Object.values(layers)) {
      transfer.push(layer.buffer);
    }
    // The kernel caches the snapshot and controllers keep reading it, so
    // channel arrays must NEVER be transferred (the transfer would detach
    // kernel-held buffers). Every typed array is .slice()d into the posted
    // snapshot and only the copy's buffer is transferred — same rule as the
    // layer copies above.
    const channels: Snapshot['channels'] = {};
    for (const [key, value] of Object.entries(snapshot.channels)) {
      channels[key] = copyChannelValue(value, transfer);
    }
    post(
      {
        kind: 'snapshot',
        snapshot: { ...snapshot, layers, channels, events },
        inspection: host.inspect(inspectHandle),
      },
      transfer,
    );
  }

  function copyChannelValue(value: unknown, transfer: Transferable[]): unknown {
    if (ArrayBuffer.isView(value)) {
      const copy = copyView(value);
      transfer.push(copy.buffer);
      return copy;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(value)) {
      if (ArrayBuffer.isView(prop)) {
        const copy = copyView(prop);
        transfer.push(copy.buffer);
        out[key] = copy;
      } else {
        out[key] = prop;
      }
    }
    return out;
  }

  function copyView(view: ArrayBufferView): ArrayBufferView {
    if (view instanceof DataView) {
      return new DataView(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    return (view as ArrayBufferView & { slice(): ArrayBufferView }).slice();
  }

  function launch(setup: unknown): void {
    const parsed = parseMatchSetup(setup);
    if (!parsed.ok) {
      postError(`invalid match setup: ${parsed.errors.join('; ')}`);
      return;
    }
    try {
      const resolved = resolve(parsed.setup);
      if ('error' in resolved) {
        postError(resolved.error);
        return;
      }
      started = true;
      crashed = false;
      firstSnapshotPosted = false;
      host = createSimHost({
        sim: resolved.sim,
        localQueue: resolved.localQueue,
        observer: resolved.observer,
        ...(resolved.ended !== undefined ? { ended: resolved.ended } : {}),
      });
    } catch (error) {
      // Content/setup failures (bad map id, missing content) must reach
      // the main thread as an error message, not an uncaught throw.
      host = null;
      postError(error instanceof Error ? error.message : String(error));
    }
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
          if (started) {
            postError('received a second start message');
            return;
          }
          launch(message.setup);
          return;
        case 'restart':
          // Replace the sim wholesale (M4 play-again): the old host is
          // dropped and the next snapshot re-sends every layer.
          host = null;
          inspectHandle = null;
          launch(message.setup);
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
        case 'inspect':
          inspectHandle = message.handle;
          return;
        default:
          postError('unknown worker message kind');
      }
    },

    pump(): void {
      if (host === null || crashed) {
        return;
      }
      try {
        const ran = host.advance(now());
        if (ran > 0) {
          postSnapshot();
        }
      } catch (error) {
        crashed = true;
        postError(error instanceof Error ? error.message : String(error));
        return;
      }
      const nowMs = now();
      if (nowMs - lastStatsPost >= STATS_INTERVAL_MS) {
        lastStatsPost = nowMs;
        post({ kind: 'stats', stats: host.stats(nowMs) });
      }
    },
  };
}
