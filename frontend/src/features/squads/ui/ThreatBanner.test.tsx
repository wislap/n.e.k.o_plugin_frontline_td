import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import type { WorkerToMain } from '../../../protocol/index';
import { createSimClient, type WorkerLike } from '../../../client/sim-client';
import type { HudContext } from '../../../ui/hud-panels';
import { SquadsChannel, type SquadView } from '../protocol';

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
  useRef: <T,>(initial: T): { current: T } => {
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
  useSyncExternalStore: <T,>(
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { ThreatBanner } = await import('./ThreatBanner');

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

function snapshotWithThreat(tick: number): Snapshot {
  const squad: SquadView = {
    id: 1,
    faction: 2,
    memberCount: 4,
    strength: 4,
    order: { kind: 'gather', x: 10, y: 10, radius: 3, launchTick: tick + 100 },
    phase: 'gather',
    centroid: { x: 10, y: 10 },
  };
  return {
    tick: toTick(tick),
    observer: toFactionId(1),
    channels: { [SquadsChannel.id]: { squads: [squad] } },
    events: [],
    layers: {},
    changedLayers: [],
  };
}

describe('ThreatBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHookState();
  });

  afterEach(() => {
    resetHookState();
    vi.useRealTimers();
  });

  it('synchronously clears stale threat on ctx.client prop swap without a stale render frame', () => {
    const workerA = fakeWorker();
    const clientA = createSimClient(workerA);
    workerA.emit({ kind: 'snapshot', snapshot: snapshotWithThreat(10) });

    const workerB = fakeWorker();
    const clientB = createSimClient(workerB);

    let activeClient = clientA;
    let renders = 0;
    const render = () => {
      hookState.idx = 0;
      renders += 1;
      return ThreatBanner({ ctx: { client: activeClient } as unknown as HudContext });
    };
    hookState.onRerender = () => {
      render();
    };

    expect(render()).not.toBeNull();

    // Swapping ctx.client to clientB (latest === null) updates synchronously in the same render.
    activeClient = clientB;
    expect(render()).toBeNull();

    // Receiving a threat snapshot on clientB triggers a reactive re-render.
    const rendersBefore = renders;
    workerB.emit({ kind: 'snapshot', snapshot: snapshotWithThreat(20) });
    expect(renders).toBe(rendersBefore + 1);
    expect(render()).not.toBeNull();
  });
});
