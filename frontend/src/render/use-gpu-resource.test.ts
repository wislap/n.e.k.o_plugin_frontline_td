import { describe, expect, it, vi } from 'vitest';
import { bindGeometry, type BindableGeometry } from './use-gpu-resource';

function makeGeo(shared = false) {
  const dispose = vi.fn<() => void>();
  const geo: BindableGeometry = {
    dispose,
    userData: shared ? { shared: true } : {},
  };
  return { geo, dispose };
}

describe('bindGeometry', () => {
  it('disposes an unshared placeholder geometry on replacement', () => {
    const placeholder = makeGeo(false);
    const next = makeGeo(true);
    const obj: { geometry: BindableGeometry } = { geometry: placeholder.geo };

    bindGeometry(obj, next.geo);

    expect(placeholder.dispose).toHaveBeenCalledTimes(1);
    expect(obj.geometry).toBe(next.geo);
  });

  it('does not dispose a geometry marked userData.shared === true when switching away', () => {
    const sharedA = makeGeo(true);
    const sharedB = makeGeo(true);
    const obj: { geometry: BindableGeometry } = { geometry: sharedA.geo };

    bindGeometry(obj, sharedB.geo);

    expect(sharedA.dispose).not.toHaveBeenCalled();
    expect(obj.geometry).toBe(sharedB.geo);
  });

  it('is a no-op when object.geometry already equals geometry', () => {
    const item = makeGeo(false);
    const obj: { geometry: BindableGeometry } = { geometry: item.geo };

    bindGeometry(obj, item.geo);

    expect(item.dispose).not.toHaveBeenCalled();
    expect(obj.geometry).toBe(item.geo);
  });
});
