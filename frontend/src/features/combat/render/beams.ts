// Combat beam collection (M3 D): the client delivers each shot event to
// this consumer exactly once via its eventsSince cursor, so no dedupe is
// needed here — beams are appended, then faded out.
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

// Extract the beam geometry from newly delivered events.
export function collectBeams(events: readonly SnapshotEventEntry[], now: number): Beam[] {
  const beams: Beam[] = [];
  for (const event of events) {
    if (event.type !== CombatShot.type) {
      continue;
    }
    const p = event.payload as ShotPayload;
    beams.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, born: now });
  }
  return beams;
}
