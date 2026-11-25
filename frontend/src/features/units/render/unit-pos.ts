// Interpolated unit positions for a snapshot pair (M2 C3/C6): one shared
// implementation used by the instanced renderer and by selection. The
// interpolator caches the previous-position handle map and rebuilds it
// only when a new latest snapshot arrives.
import { readChannel } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import type { SnapshotPair } from '../../../client/sim-client';
import type { DenseUnits } from '../protocol';
import { DenseUnitsChannel } from '../protocol';
import { interpAlpha, lerp } from '../../../render/interpolate';

export interface InterpUnit {
  x: number;
  y: number;
  faction: number;
}

// Stateful per-frame interpolator: call update() with the newest pair,
// then interpolated() for each row of the latest channel.
export class UnitInterpolator {
  private latestSnap: Snapshot | null = null;
  private prevPos = new Map<number, { x: number; y: number }>();
  // True when the last update() saw a new latest snapshot (callers use it
  // to run per-snapshot work like selection pruning).
  prevSnapshotChanged = false;

  update(pair: SnapshotPair): DenseUnits | null {
    const latest = readChannel(pair.latest, DenseUnitsChannel);
    this.prevSnapshotChanged = pair.latest !== this.latestSnap;
    if (this.prevSnapshotChanged) {
      this.latestSnap = pair.latest;
      this.prevPos = new Map();
      const prev = readChannel(pair.previous, DenseUnitsChannel);
      if (prev !== null) {
        for (let i = 0; i < prev.handles.length; i++) {
          this.prevPos.set(prev.handles[i] ?? 0, {
            x: prev.x[i] ?? 0,
            y: prev.y[i] ?? 0,
          });
        }
      }
    }
    return latest;
  }

  // Interpolated map coordinates for channel row i (new units appear at
  // the latest position).
  interpolated(latest: DenseUnits, i: number, alpha: number): { x: number; y: number } {
    const lx = latest.x[i] ?? 0;
    const ly = latest.y[i] ?? 0;
    const prev = this.prevPos.get(latest.handles[i] ?? 0);
    if (prev === undefined) {
      return { x: lx, y: ly };
    }
    return { x: lerp(prev.x, lx, alpha), y: lerp(prev.y, ly, alpha) };
  }
}

// One-shot map of handle → interpolated position/faction (box and click
// selection paths).
export function interpolatedUnits(pair: SnapshotPair, now: number): Map<number, InterpUnit> {
  const result = new Map<number, InterpUnit>();
  const latest = readChannel(pair.latest, DenseUnitsChannel);
  if (latest === null) {
    return result;
  }
  const alpha = interpAlpha(now, pair.receivedAt, pair.intervalMs);
  const interp = new UnitInterpolator();
  interp.update(pair);
  for (let i = 0; i < latest.handles.length; i++) {
    const handle = latest.handles[i] ?? 0;
    const pos = interp.interpolated(latest, i, alpha);
    result.set(handle, { ...pos, faction: latest.faction[i] ?? 0 });
  }
  return result;
}
