// Snapshot interpolation helpers (M2 C3). Alpha is clamped to [0, 1]; the
// interval is the time between the two most recent snapshot receipts, with
// a fallback for the very first snapshot.
import { TICK_MS } from '../core/index';

export function interpAlpha(
  now: number,
  receivedAt: number,
  intervalMs: number,
  fallbackMs: number = TICK_MS,
): number {
  const interval = intervalMs > 0 ? intervalMs : fallbackMs;
  const alpha = (now - receivedAt) / interval;
  return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
