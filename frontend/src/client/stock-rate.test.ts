import { describe, expect, it } from 'vitest';
import { createStockRateTracker } from './stock-rate';

describe('createStockRateTracker', () => {
  it('returns zeros before two distinct ticks and computes milli/sec over the window', () => {
    const tracker = createStockRateTracker(200);
    expect(tracker.sample(10, [1000, 500])).toEqual([0, 0]);
    // Same tick repeats cached rates.
    expect(tracker.sample(10, [1500, 500])).toEqual([0, 0]);

    // +20 ticks (1 second at 20 TPS): +2000 milli -> +2000/s, -500 milli -> -500/s.
    expect(tracker.sample(30, [3000, 0])).toEqual([2000, -500]);
    // Same tick again returns cached non-zero rates.
    expect(tracker.sample(30, [3000, 0])).toEqual([2000, -500]);
  });

  it('evicts samples older than windowTicks and resets when tick decreases', () => {
    const tracker = createStockRateTracker(100);
    expect(tracker.sample(0, [0])).toEqual([0]);
    expect(tracker.sample(50, [2500])).toEqual([1000]);
    // At tick 150, tick 0 is outside the 100-tick window, so oldest is tick 50 (dt=100, +5000 milli -> 1000/s).
    expect(tracker.sample(150, [7500])).toEqual([1000]);

    // Decreasing tick indicates a match restart and resets history.
    expect(tracker.sample(5, [1000])).toEqual([0]);
    expect(tracker.sample(25, [3000])).toEqual([2000]);

    tracker.reset();
    expect(tracker.sample(30, [5000])).toEqual([0]);
  });
});
