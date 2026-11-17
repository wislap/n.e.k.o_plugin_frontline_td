// Combat beam collection (M3 D): combat.shot events are last-tick only,
// so the layer dedupes by snapshot tick — each tick's events are appended
// once, then faded out. Skipped snapshots drop their beams (accepted).
import type { SnapshotEventEntry } from '../../../core/index';
import { CombatShot, type ShotPayload } from '../protocol';

export interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // Wall-clock spawn time (performance.now()), for fade-out.
  born: number;
}

export const BEAM_LIFE_MS = 150;

// Extract the beam geometry from one tick's events. Returns an empty list
// when the tick was already consumed (dedupe by snapshot tick).
export function collectBeams(
  events: readonly SnapshotEventEntry[],
  tick: number,
  lastTick: number,
  now: number,
): { beams: Beam[]; tick: number } {
  if (tick === lastTick) {
    return { beams: [], tick: lastTick };
  }
  const beams: Beam[] = [];
  for (const event of events) {
    if (event.type !== CombatShot.type) {
      continue;
    }
    const p = event.payload as ShotPayload;
    beams.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, born: now });
  }
  return { beams, tick };
}
