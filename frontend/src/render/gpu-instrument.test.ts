import { describe, expect, it } from 'vitest';
import { materialLabel, resolveSceneLayerId } from './gpu-instrument';

type FakeObject = {
  parent: FakeObject | null;
  userData: Record<string, unknown>;
};

const obj = (
  userData: Record<string, unknown> = {},
  parent: FakeObject | null = null,
): FakeObject => ({
  parent,
  userData,
});

describe('resolveSceneLayerId', () => {
  it('finds the nearest ancestor carrying sceneLayerId', () => {
    const tagged = obj({ sceneLayerId: 'units' });
    const mid = obj({}, tagged);
    const leaf = obj({}, mid);
    expect(resolveSceneLayerId(leaf)).toBe('units');
    expect(resolveSceneLayerId(tagged)).toBe('units');
  });

  it('uses the nearest tag when nested groups both carry ids', () => {
    const outer = obj({ sceneLayerId: 'terrain' });
    const inner = obj({ sceneLayerId: 'overlay' }, outer);
    expect(resolveSceneLayerId(obj({}, inner))).toBe('overlay');
  });

  it('falls back to shell outside the registry layers', () => {
    const root = obj({});
    const leaf = obj({}, root);
    expect(resolveSceneLayerId(leaf)).toBe('shell');
    expect(resolveSceneLayerId(root)).toBe('shell');
  });
});

describe('materialLabel', () => {
  it('prefers an authored material name over the type', () => {
    expect(materialLabel({ name: 'coverRing', type: 'MeshBasicMaterial' })).toBe('coverRing');
  });

  it('falls back to the material type', () => {
    expect(materialLabel({ name: '', type: 'MeshStandardMaterial' })).toBe('MeshStandardMaterial');
    expect(materialLabel({ type: 'MeshDepthMaterial' })).toBe('MeshDepthMaterial');
  });

  it('handles arrays and missing material', () => {
    expect(materialLabel([{ type: 'MeshBasicMaterial' }])).toBe('multi');
    expect(materialLabel(null)).toBe('none');
  });
});
