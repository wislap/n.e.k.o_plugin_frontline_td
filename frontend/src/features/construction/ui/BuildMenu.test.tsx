import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../../content/index';
import type { StateCreator } from 'zustand/vanilla';
import type { HudContext } from '../../../ui/hud-panels';

const hookState = {
  states: [] as unknown[],
  memos: [] as { value: unknown; deps: readonly unknown[] }[],
  effects: [] as {
    deps: readonly unknown[] | undefined;
    cleanup: (() => void) | undefined;
  }[],
  callbacks: [] as { fn: unknown; deps: readonly unknown[] }[],
  stateIdx: 0,
  memoIdx: 0,
  effectIdx: 0,
  callbackIdx: 0,
};

function resetHooks(): void {
  for (const eff of hookState.effects) {
    eff.cleanup?.();
  }
  hookState.states = [];
  hookState.memos = [];
  hookState.effects = [];
  hookState.callbacks = [];
  hookState.stateIdx = 0;
  hookState.memoIdx = 0;
  hookState.effectIdx = 0;
  hookState.callbackIdx = 0;
}

function unmountAll(): void {
  for (const eff of hookState.effects) {
    eff.cleanup?.();
    eff.cleanup = undefined;
  }
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const hooks = {
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
      const i = hookState.stateIdx++;
      if (!(i in hookState.states)) {
        hookState.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((prev: T) => T)) => {
        hookState.states[i] =
          typeof next === 'function' ? (next as (prev: T) => T)(hookState.states[i] as T) : next;
      };
      return [hookState.states[i] as T, setState];
    },
    useMemo: <T,>(factory: () => T, deps: readonly unknown[]): T => {
      const i = hookState.memoIdx++;
      const prev = hookState.memos[i];
      if (
        prev !== undefined &&
        prev.deps.length === deps.length &&
        prev.deps.every((d, k) => Object.is(d, deps[k]))
      ) {
        return prev.value as T;
      }
      const value = factory();
      hookState.memos[i] = { value, deps };
      return value;
    },
    useEffect: (fn: () => (() => void) | undefined, deps?: readonly unknown[]): void => {
      const i = hookState.effectIdx++;
      const prev = hookState.effects[i];
      const changed =
        prev === undefined ||
        deps === undefined ||
        prev.deps === undefined ||
        prev.deps.length !== deps.length ||
        !prev.deps.every((d, k) => Object.is(d, deps[k]));
      if (changed) {
        prev?.cleanup?.();
        const cleanup = fn();
        hookState.effects[i] = {
          deps,
          cleanup,
        };
      }
    },
    useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T => {
      const i = hookState.callbackIdx++;
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
      _subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
    ): T => getSnapshot(),
    useDebugValue: () => undefined,
  };
  return {
    ...actual,
    ...hooks,
    default: {
      ...actual,
      ...hooks,
    },
  };
});

vi.mock('zustand', async () => {
  const { createStore } =
    await vi.importActual<typeof import('zustand/vanilla')>('zustand/vanilla');
  const createImpl = <T,>(initializer: StateCreator<T>) => {
    const api = createStore(initializer);
    const useBoundStore = <U = T,>(selector?: (state: T) => U): U =>
      selector !== undefined ? selector(api.getState()) : (api.getState() as unknown as U);
    return Object.assign(useBoundStore, api);
  };
  const create = <T,>(initializer?: StateCreator<T>) =>
    initializer !== undefined ? createImpl(initializer) : createImpl;
  return { create };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../client/intent', () => ({
  useIntentRouter: () => ({
    dispatch: vi.fn(),
    setCanvasHandler: vi.fn(),
  }),
}));

const { useInteractionStore } = await import('../../../client/interaction-store');
const { createBuildMenuPanel } = await import('./BuildMenu');

describe('createBuildMenuPanel lazy thumbnails', () => {
  const db = loadContent();

  beforeEach(() => {
    vi.useFakeTimers();
    resetHooks();
    useInteractionStore.getState().reset();
  });

  afterEach(() => {
    resetHooks();
    useInteractionStore.getState().reset();
    vi.useRealTimers();
  });

  function mountAndRender(Panel: ReturnType<typeof createBuildMenuPanel>, ctxDb = db): unknown {
    hookState.stateIdx = 0;
    hookState.memoIdx = 0;
    hookState.effectIdx = 0;
    hookState.callbackIdx = 0;
    return Panel({ ctx: { db: ctxDb } as unknown as HudContext });
  }

  it('does not render thumbnails on boot when mode !== build', () => {
    const renderThumbnails = vi.fn(
      () => new Map([['frontline_td:turret', 'data:image/png;base64,x']]),
    );
    const Panel = createBuildMenuPanel(renderThumbnails);

    expect(useInteractionStore.getState().mode).toBe('command');
    expect(mountAndRender(Panel)).toBeNull();
    vi.runAllTimers();
    expect(renderThumbnails).not.toHaveBeenCalled();
  });

  it('renders thumbnails lazily once on first entry to build mode and caches across toggles', () => {
    const renderThumbnails = vi.fn(
      () => new Map([['frontline_td:turret', 'data:image/png;base64,x']]),
    );
    const Panel = createBuildMenuPanel(renderThumbnails);

    // Boot in command mode.
    expect(mountAndRender(Panel)).toBeNull();
    vi.runAllTimers();
    expect(renderThumbnails).not.toHaveBeenCalled();

    // Enter build mode.
    useInteractionStore.getState().setMode('build');
    expect(mountAndRender(Panel)).not.toBeNull();
    expect(renderThumbnails).not.toHaveBeenCalled();

    // Macrotask fires and populates cached thumbs.
    vi.runAllTimers();
    expect(renderThumbnails).toHaveBeenCalledTimes(1);
    expect(renderThumbnails).toHaveBeenCalledWith(db);

    // Re-render in build mode, leave to command, and re-enter build mode: no duplicate render.
    expect(mountAndRender(Panel)).not.toBeNull();
    useInteractionStore.getState().setMode('command');
    expect(mountAndRender(Panel)).toBeNull();
    useInteractionStore.getState().setMode('build');
    expect(mountAndRender(Panel)).not.toBeNull();
    vi.runAllTimers();
    expect(renderThumbnails).toHaveBeenCalledTimes(1);
  });

  it('cancels pending thumbnail timer if mode leaves build or panel unmounts before timeout', () => {
    const renderThumbnails = vi.fn(() => new Map<string, string>());
    const Panel = createBuildMenuPanel(renderThumbnails);

    useInteractionStore.getState().setMode('build');
    expect(mountAndRender(Panel)).not.toBeNull();
    useInteractionStore.getState().setMode('command');
    expect(mountAndRender(Panel)).toBeNull();
    vi.runAllTimers();
    expect(renderThumbnails).not.toHaveBeenCalled();

    // Re-enter build and unmount before timeout fires.
    useInteractionStore.getState().setMode('build');
    expect(mountAndRender(Panel)).not.toBeNull();
    unmountAll();
    vi.runAllTimers();
    expect(renderThumbnails).not.toHaveBeenCalled();
  });

  it('renders build menu cards cleanly when renderThumbnails is omitted', () => {
    const Panel = createBuildMenuPanel();
    useInteractionStore.getState().setMode('build');
    expect(mountAndRender(Panel)).not.toBeNull();
    vi.runAllTimers();
  });
});
