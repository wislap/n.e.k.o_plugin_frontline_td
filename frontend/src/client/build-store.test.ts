// Build-store state transitions (M3 D).
import { describe, expect, it } from 'vitest';
import { useBuildStore } from './build-store';

describe('build-store', () => {
  it('selects, mirrors ghost state and cancels', () => {
    const store = useBuildStore.getState();
    store.select('frontline_td:station');
    expect(useBuildStore.getState().kind).toBe('frontline_td:station');
    store.setGhost({ x: 4, y: 5, code: 'occupied' });
    expect(useBuildStore.getState().ghost).toEqual({ x: 4, y: 5, code: 'occupied' });
    store.cancel();
    expect(useBuildStore.getState().kind).toBeNull();
    expect(useBuildStore.getState().ghost).toBeNull();
  });
});
