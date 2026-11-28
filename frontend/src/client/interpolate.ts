// Snapshot interpolation helpers (M2 C3, M3A): alpha is clamped to [0, 1]
// using the interval between the two most recent snapshot receipts, with a
// fallback for the very first snapshot. ChannelPositionInterpolator and
// interpolateChannelEntities operate on any structurally matching snapshot
// channel without coupling client/ to features/*.
import { readChannel, TICK_MS } from '../core/index';
import type { Snapshot, SnapshotChannelDef } from '../core/index';
import type { SnapshotPair } from './sim-client';

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

export interface PositionedChannel {
  readonly handles: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

export interface FactionPositionedChannel extends PositionedChannel {
  readonly faction: ArrayLike<number>;
}

export interface InterpEntity {
  x: number;
  y: number;
  faction: number;
}

// Stateful per-frame interpolator: call update() with the newest pair,
// then interpolated() for each row of the latest channel.
export class ChannelPositionInterpolator<T extends PositionedChannel> {
  private readonly channel: SnapshotChannelDef<T>;
  private latestSnap: Snapshot | null = null;
  private prevPos = new Map<number, { x: number; y: number }>();
  // True when the last update() saw a new latest snapshot (callers use it
  // to run per-snapshot work).
  prevSnapshotChanged = false;

  constructor(channel: SnapshotChannelDef<T>) {
    this.channel = channel;
  }

  update(pair: SnapshotPair): T | null {
    const latest = readChannel(pair.latest, this.channel);
    this.prevSnapshotChanged = pair.latest !== this.latestSnap;
    if (this.prevSnapshotChanged) {
      this.latestSnap = pair.latest;
      this.prevPos = new Map();
      const prev = readChannel(pair.previous, this.channel);
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

  // Interpolated map coordinates for channel row i (new entities appear at
  // the latest position).
  interpolated(latest: T, i: number, alpha: number): { x: number; y: number } {
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
export function interpolateChannelEntities<T extends FactionPositionedChannel>(
  channel: SnapshotChannelDef<T>,
  pair: SnapshotPair,
  now: number,
): Map<number, InterpEntity> {
  const result = new Map<number, InterpEntity>();
  const latest = readChannel(pair.latest, channel);
  if (latest === null) {
    return result;
  }
  const alpha = interpAlpha(now, pair.receivedAt, pair.intervalMs);
  const interp = new ChannelPositionInterpolator(channel);
  interp.update(pair);
  for (let i = 0; i < latest.handles.length; i++) {
    const handle = latest.handles[i] ?? 0;
    const pos = interp.interpolated(latest, i, alpha);
    result.set(handle, { ...pos, faction: latest.faction[i] ?? 0 });
  }
  return result;
}
