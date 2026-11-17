// Pure client helpers for the HUD (M4): speed stepping, tick→clock
// formatting, and end-screen outcome mapping.

export function nextSpeedIndex(current: number, delta: number, steps: number): number {
  return Math.min(steps - 1, Math.max(0, current + delta));
}

// Ticks (50 ms each) → "mm:ss"; negative values clamp to zero.
export function formatClock(ticks: number): string {
  const seconds = Math.max(0, Math.floor(ticks / 20));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export type MatchOutcome = 'victory' | 'defeat' | 'draw';

// Maps the assault channel's ended state to the observer-relative result
// (winner −1 = draw). Null while the match is still running.
export function matchOutcome(
  ended: { ended: number; winner: number } | null | undefined,
  observer: number,
): MatchOutcome | null {
  if (ended === null || ended === undefined || ended.ended === 0) {
    return null;
  }
  if (ended.winner === -1) {
    return 'draw';
  }
  return ended.winner === observer ? 'victory' : 'defeat';
}
