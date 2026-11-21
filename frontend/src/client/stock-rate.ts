// Rolling per-cargo warehouse stock net-rate tracker (milli per second)
// over a fixed tick window.
import { TICKS_PER_SECOND } from '../core/index';

const DEFAULT_WINDOW_TICKS = 200;

export interface StockRateTracker {
  sample(tick: number, stock: readonly number[]): readonly number[];
  reset(): void;
}

interface StockSample {
  tick: number;
  stock: readonly number[];
}

export function createStockRateTracker(
  windowTicks: number = DEFAULT_WINDOW_TICKS,
): StockRateTracker {
  let history: StockSample[] = [];
  let lastRates: number[] = [];

  const reset = (): void => {
    history = [];
    lastRates = [];
  };

  return {
    sample(tick: number, stock: readonly number[]): readonly number[] {
      const prev = history[history.length - 1];
      if (prev !== undefined) {
        if (tick < prev.tick) {
          reset();
        } else if (tick === prev.tick) {
          return lastRates.length === stock.length ? lastRates : stock.map(() => 0);
        }
      }

      history.push({ tick, stock: [...stock] });
      while (history.length > 1) {
        const head = history[0];
        if (head === undefined || tick - head.tick <= windowTicks) {
          break;
        }
        history.shift();
      }

      const oldest = history[0];
      if (oldest === undefined || history.length < 2) {
        lastRates = stock.map(() => 0);
        return lastRates;
      }

      const dt = tick - oldest.tick;
      if (dt <= 0) {
        lastRates = stock.map(() => 0);
        return lastRates;
      }

      lastRates = stock.map((curVal, i) => {
        const oldVal = oldest.stock[i] ?? 0;
        const rate = Math.round(((curVal - oldVal) * TICKS_PER_SECOND) / dt);
        return rate === 0 ? 0 : rate;
      });
      return lastRates;
    },
    reset,
  };
}
