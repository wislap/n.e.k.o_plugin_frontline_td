import { describe, expect, it } from 'vitest';
import { sortContributions } from './contributions';

function def(id: string, order: number): { id: string; order: number } {
  return { id, order };
}

describe('sortContributions', () => {
  it('sorts by order ascending', () => {
    const sorted = sortContributions([def('b', 300), def('a', 100), def('c', 200)]);
    expect(sorted.map((d) => d.id)).toEqual(['a', 'c', 'b']);
  });

  it('is stable for equal orders (insertion order wins)', () => {
    const sorted = sortContributions([
      def('first', 200),
      def('second', 200),
      def('earlier', 100),
      def('third', 200),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(['earlier', 'first', 'second', 'third']);
  });

  it('throws on duplicate ids', () => {
    expect(() => sortContributions([def('x', 1), def('x', 2)])).toThrow(
      'duplicate contribution id: x',
    );
  });

  it('does not mutate the input array', () => {
    const input = [def('b', 2), def('a', 1)];
    sortContributions(input);
    expect(input.map((d) => d.id)).toEqual(['b', 'a']);
  });
});
