import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_REJECTED, toFactionId, toTick, type Snapshot } from '../core/index';
import type { MatchSetup, WorkerToMain } from '../protocol/index';
import { createSimClient, type WorkerLike } from '../client/sim-client';
import type { HudContext, HudPanelProps } from './hud-panels';
import { useToastStore } from './toast-store';

interface EffectEntry {
  deps: readonly unknown[];
  cleanup: (() => void) | undefined;
}

const hookState = {
  effects: [] as EffectEntry[],
  idx: 0,
};

function resetHooks(): void {
  for (const e of hookState.effects) {
    e.cleanup?.();
  }
  hookState.effects = [];
  hookState.idx = 0;
}

vi.mock('zustand', async () => {
  const { createStore } = await import('zustand/vanilla');
  type Creator<T> = import('zustand/vanilla').StateCreator<T>;
  const createImpl = <T,>(createState: Creator<T>) => {
    const api = createStore<T>()(createState);
    const useBound = (selector?: (s: T) => unknown): unknown =>
      selector !== undefined ? selector(api.getState()) : api.getState();
    return Object.assign(useBound, api);
  };
  return {
    create: (<T,>(createState?: Creator<T>) =>
      createState !== undefined
        ? createImpl(createState)
        : (fn: Creator<T>) => createImpl(fn)) as unknown,
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (fn: () => (() => void) | undefined, deps: readonly unknown[]): void => {
      const i = hookState.idx++;
      const prev = hookState.effects[i];
      const changed =
        prev === undefined ||
        prev.deps.length !== deps.length ||
        prev.deps.some((d, k) => !Object.is(d, deps[k]));
      if (changed) {
        prev?.cleanup?.();
        hookState.effects[i] = { deps, cleanup: fn() };
      }
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { reason?: string }) =>
      opts?.reason !== undefined ? `${key}:${opts.reason}` : key,
  }),
}));

const { SHELL_HUD_PANELS } = await import('./shell-panels');

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

function snapWithRejected(tick: number, reasons: string[]): Snapshot {
  return {
    tick: toTick(tick),
    observer: toFactionId(1),
    channels: {},
    events: reasons.map((reason) => ({
      type: COMMAND_REJECTED.type,
      payload: { reason },
    })),
    layers: {},
    changedLayers: [],
  };
}

describe('ToastsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHooks();
    useToastStore.setState({ items: [] });
  });

  afterEach(() => {
    resetHooks();
    useToastStore.setState({ items: [] });
    vi.useRealTimers();
  });

  it('resets its event cursor on client.restart() even when new events arrive within the 100 ms coalescer window', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    const toastsDef = SHELL_HUD_PANELS.find((p) => p.id === 'shell.toasts');
    expect(toastsDef).toBeDefined();
    if (toastsDef === undefined) {
      return;
    }

    const ctx = { client } as unknown as HudContext;
    hookState.idx = 0;
    const Toasts = toastsDef.Component as (props: HudPanelProps) => unknown;
    Toasts({ ctx });

    // t=0: 5 rejected events advance cursor to 5.
    worker.emit({
      kind: 'snapshot',
      snapshot: snapWithRejected(1, ['pre_0', 'pre_1', 'pre_2', 'pre_3', 'pre_4']),
    });
    expect(useToastStore.getState().items.map((i) => i.text)).toEqual([
      'hud.rejected:reason.pre_1',
      'hud.rejected:reason.pre_2',
      'hud.rejected:reason.pre_3',
      'hud.rejected:reason.pre_4',
    ]);

    // t=20 ms: restart() resets worker eventSeq to 0 inside the 100 ms window.
    useToastStore.setState({ items: [] });
    vi.advanceTimersByTime(20);
    client.restart({} as MatchSetup);

    // t=40 ms: 6 new events arrive (seq 1..6 > old cursor 5) before trailing flush.
    vi.advanceTimersByTime(20);
    worker.emit({
      kind: 'snapshot',
      snapshot: snapWithRejected(1, ['post_0', 'post_1', 'post_2', 'post_3', 'post_4', 'post_5']),
    });

    // t=100 ms: trailing flush must deliver all 6 post-restart events (last 4 retained by MAX_TOASTS=4).
    vi.advanceTimersByTime(60);
    expect(useToastStore.getState().items.map((i) => i.text)).toEqual([
      'hud.rejected:reason.post_2',
      'hud.rejected:reason.post_3',
      'hud.rejected:reason.post_4',
      'hud.rejected:reason.post_5',
    ]);
  });
});
