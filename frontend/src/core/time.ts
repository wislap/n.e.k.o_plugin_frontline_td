import type { Brand } from './brand';

export type Tick = Brand<number, 'Tick'>;
export const TICK_MS = 50;
export const TICKS_PER_SECOND = 20;

export function toTick(n: number): Tick {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`tick must be a non-negative safe integer, got ${n}`);
  }
  return n as Tick;
}
