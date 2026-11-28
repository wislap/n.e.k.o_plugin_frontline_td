// EndScreen unit tests: verifies observer-relative outcome rendering and
// that enemy waves count sums hostile waves.* probes instead of reading the
// winning player's own waves probe (which is 0 on victory).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFactionId, toTick, type Snapshot } from '../../../core/index';
import type { WorkerToMain } from '../../../protocol/index';
import { createSimClient, type WorkerLike } from '../../../client/sim-client';
import { AssaultChannel } from '../protocol';

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; time?: string }) =>
      opts?.count !== undefined
        ? `${key}:${opts.count}`
        : opts?.time !== undefined
          ? `${key}:${opts.time}`
          : key,
  }),
}));

const { useRuntimeStore } = await import('../../../client/runtime-store');
const { EndScreen } = await import('./EndScreen');

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

function endedSnapshot(observer: number, winner: number, tick = 2400): Snapshot {
  return {
    tick: toTick(tick),
    observer: toFactionId(observer),
    channels: {
      [AssaultChannel.id]: {
        ended: 1,
        winner,
        tick,
        eliminated: [winner === 1 ? 2 : 1],
      },
    },
    events: [],
    layers: {},
    changedLayers: [],
  };
}

describe('EndScreen', () => {
  beforeEach(() => {
    useRuntimeStore.getState().reset();
  });

  afterEach(() => {
    useRuntimeStore.getState().reset();
  });

  it('shows enemy waves.f2 on victory (winner: 1, observer: 1) when waves.f1 is 0', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    worker.emit({ kind: 'snapshot', snapshot: endedSnapshot(1, 1) });
    useRuntimeStore.getState().setStats({
      tick: toTick(2400),
      speedIndex: 0,
      paused: false,
      tickRate: 20,
      entityCount: 42,
      systems: [],
      probes: {
        'frontline_td:assault.units.f1': 5,
        'frontline_td:assault.structures.f1': 4,
        'frontline_td:assault.waves.f1': 0,
        'frontline_td:assault.waves.f2': 6,
        'frontline_td:assault.stock.f1.material': 1200,
      },
    });

    const html = renderToStaticMarkup(<EndScreen client={client} onRestart={() => undefined} />);
    expect(html).toContain('end.victory');
    expect(html).toContain('end.waves:6');
    expect(html).not.toContain('end.waves:0');
  });

  it('shows enemy waves.f2 on defeat (winner: 2, observer: 1)', () => {
    const worker = fakeWorker();
    const client = createSimClient(worker);
    worker.emit({ kind: 'snapshot', snapshot: endedSnapshot(1, 2) });
    useRuntimeStore.getState().setStats({
      tick: toTick(2400),
      speedIndex: 0,
      paused: false,
      tickRate: 20,
      entityCount: 18,
      systems: [],
      probes: {
        'frontline_td:assault.units.f1': 0,
        'frontline_td:assault.structures.f1': 0,
        'frontline_td:assault.waves.f1': 0,
        'frontline_td:assault.waves.f2': 6,
      },
    });

    const html = renderToStaticMarkup(<EndScreen client={client} onRestart={() => undefined} />);
    expect(html).toContain('end.defeat');
    expect(html).toContain('end.waves:6');
  });
});
