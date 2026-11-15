// Tick conversion helpers for content definitions (ADR 0020): content uses
// seconds/units; the sim uses integer ticks and milli-units.
import { floorDiv, TICKS_PER_SECOND, MILLI } from '../core/index';
import type { Tick } from '../core/index';
import { toTick } from '../core/index';

function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

export function secondsToTicks(seconds: number): Tick {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`secondsToTicks expects a finite non-negative number, got ${seconds}`);
  }
  return toTick(Math.max(1, roundHalfUp(seconds * TICKS_PER_SECOND)));
}

export function unitsToMilli(units: number): number {
  if (!Number.isFinite(units)) {
    throw new RangeError(`unitsToMilli expects a finite number, got ${units}`);
  }
  return roundHalfUp(units * MILLI);
}

export function perSecondToPerTick(unitsPerSecond: number): number {
  return floorDiv(unitsToMilli(unitsPerSecond), TICKS_PER_SECOND);
}
