import { describe, expect, it } from 'vitest';
import { SCENE_ORDER, sortSceneLayers, type SceneLayerDef } from './scene';

const NullComponent = (): null => null;

function def(id: string, order: number): SceneLayerDef {
  return { id, order, Component: NullComponent };
}

describe('sortSceneLayers', () => {
  it('sorts by order ascending', () => {
    const sorted = sortSceneLayers([def('b', 300), def('a', 100), def('c', 200)]);
    expect(sorted.map((d) => d.id)).toEqual(['a', 'c', 'b']);
  });

  it('is stable for equal orders (insertion order wins)', () => {
    const sorted = sortSceneLayers([
      def('first', SCENE_ORDER.overlay),
      def('second', SCENE_ORDER.overlay),
      def('earlier', SCENE_ORDER.ground),
      def('third', SCENE_ORDER.overlay),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(['earlier', 'first', 'second', 'third']);
  });

  it('throws on duplicate ids', () => {
    expect(() => sortSceneLayers([def('x', 1), def('x', 2)])).toThrow(
      'duplicate scene layer id: x',
    );
  });

  it('does not mutate the input array', () => {
    const input = [def('b', 2), def('a', 1)];
    sortSceneLayers(input);
    expect(input.map((d) => d.id)).toEqual(['b', 'a']);
  });
});
