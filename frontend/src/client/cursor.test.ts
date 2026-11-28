import { afterEach, describe, expect, it } from 'vitest';
import { cursorState } from './cursor';

describe('cursorState.subscribeGround', () => {
  afterEach(() => {
    cursorState.reset();
  });

  it('does not invoke a sibling listener unsubscribed earlier in the same notification wave', () => {
    const calls: string[] = [];
    let unsubB: () => void = () => undefined;
    const unsubA = cursorState.subscribeGround(() => {
      calls.push('A');
      unsubB();
    });
    unsubB = cursorState.subscribeGround(() => {
      calls.push('B');
    });
    const unsubC = cursorState.subscribeGround(() => {
      calls.push('C');
    });

    cursorState.setGround({ x: 4, y: 8 });
    expect(calls).toEqual(['A', 'C']);

    unsubA();
    unsubB();
    unsubC();
  });
});
