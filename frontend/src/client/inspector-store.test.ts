import { beforeEach, describe, expect, it } from 'vitest';
import { activeInspectorSubject, sameHoverSubject, useInspectorStore } from './inspector-store';

describe('inspector store', () => {
  beforeEach(() => {
    useInspectorStore.getState().reset();
  });

  it('compares hover subjects structurally', () => {
    expect(sameHoverSubject(null, null)).toBe(true);
    expect(sameHoverSubject({ kind: 'cell', x: 1, y: 2 }, { kind: 'cell', x: 1, y: 2 })).toBe(true);
    expect(sameHoverSubject({ kind: 'cell', x: 1, y: 2 }, { kind: 'cell', x: 1, y: 3 })).toBe(
      false,
    );
    expect(
      sameHoverSubject({ kind: 'own_unit', handle: 7 }, { kind: 'hostile_unit', handle: 7 }),
    ).toBe(false);
    expect(
      sameHoverSubject(
        { kind: 'memory', handle: 1, kindIndex: 2, x: 3, y: 4, faction: 2, state: 3 },
        { kind: 'memory', handle: 1, kindIndex: 2, x: 3, y: 4, faction: 2, state: 3 },
      ),
    ).toBe(true);
    expect(
      sameHoverSubject(
        { kind: 'memory', handle: 1, kindIndex: 2, x: 3, y: 4, faction: 2, state: 3 },
        { kind: 'memory', handle: 1, kindIndex: 2, x: 3, y: 4, faction: 2, state: 4 },
      ),
    ).toBe(false);
  });

  it('prioritizes pinned subject over hovered subject and skips redundant updates', () => {
    const store = useInspectorStore.getState();
    expect(activeInspectorSubject(store)).toBeNull();

    const cell = { kind: 'cell' as const, x: 4, y: 5 };
    store.setHovered(cell);
    expect(activeInspectorSubject(useInspectorStore.getState())).toEqual(cell);

    // Identical structural subject keeps the exact reference.
    store.setHovered({ kind: 'cell', x: 4, y: 5 });
    expect(useInspectorStore.getState().hovered).toBe(cell);

    const pinned = { kind: 'own_structure' as const, handle: 42 };
    store.pin(pinned);
    expect(activeInspectorSubject(useInspectorStore.getState())).toEqual(pinned);

    store.unpin();
    expect(useInspectorStore.getState().pinned).toBeNull();
    expect(activeInspectorSubject(useInspectorStore.getState())).toEqual(cell);
  });
});
