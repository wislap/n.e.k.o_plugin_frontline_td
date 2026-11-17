// Client-side exponential moving average for link utilization (M3 D):
// outBp + inBp is smoothed over a ~30 s window so the overlay brightness
// reflects sustained flow rather than single cycles.
export const FLOW_WINDOW_MS = 30_000;

// EMA update with the standard exponential alpha; deterministic and
// frame-rate independent (alpha is derived from the elapsed time).
export function emaUpdate(
  prev: number,
  next: number,
  dtMs: number,
  windowMs: number = FLOW_WINDOW_MS,
): number {
  if (dtMs <= 0) {
    return prev;
  }
  const alpha = 1 - Math.exp(-dtMs / windowMs);
  return prev + (next - prev) * alpha;
}
