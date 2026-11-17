// Fixed-timestep driver for the sim inside the worker (ADR 0005): a
// speed-multiplied accumulator, catch-up capped so a stalled tab slows the
// game instead of spiralling, and stats for the debug panel.
import { TICK_MS, toTick } from '../core/index';
import type { EntityHandle, FactionId, Inspection, Snapshot } from '../core/index';
import type { QueuedController, Simulation } from '../kernel/index';
import type { RuntimeStats } from '../protocol/index';
import { SPEED_STEPS } from '../protocol/index';

const MAX_CATCHUP_TICKS = 5;
const TICK_RATE_WINDOW_MS = 1000;
const ENTITIES_PROBE = 'frontline_td:kernel.entities';

export interface SimHostOptions {
  sim: Simulation;
  localQueue: QueuedController | null;
  observer: FactionId;
}

export interface SimHost {
  // Returns how many ticks ran. The first call only records the time.
  advance(nowMs: number): number;
  setSpeedIndex(index: number): void;
  togglePause(): void;
  submitLocal(command: { type: string; payload: unknown }): void;
  stats(nowMs: number): RuntimeStats;
  latestSnapshot(): Snapshot;
  // Read-only entity inspection for the observer (null when unset/invalid).
  inspect(handle: EntityHandle | null): Inspection | null;
  // Union of layer keys changed by every tick run since the last call —
  // the worker transport posts only these layers, and skipped ticks must
  // not lose their changes.
  takeChangedLayers(): Set<string>;
  readonly speedIndex: number;
  readonly paused: boolean;
}

export function createSimHost(options: SimHostOptions): SimHost {
  const { sim, localQueue, observer } = options;
  let speedIndex = 1;
  let lastNonZeroIndex = 1;
  let accumulator = 0;
  let lastNow: number | null = null;
  const tickTimes: number[] = [];
  const changedLayers = new Set<string>();
  let prevTimings: Record<string, { count: number; total: number }> = {};

  function runTicks(count: number): number {
    for (let k = 0; k < count; k++) {
      sim.step();
      for (const key of sim.changedLayers()) {
        changedLayers.add(key);
      }
    }
    return count;
  }

  return {
    get speedIndex() {
      return speedIndex;
    },
    get paused() {
      return speedIndex === 0;
    },

    advance(nowMs: number): number {
      if (lastNow === null) {
        lastNow = nowMs;
        return 0;
      }
      const elapsed = nowMs - lastNow;
      lastNow = nowMs;
      const speed = SPEED_STEPS[speedIndex] ?? 0;
      if (speed === 0) {
        accumulator = 0;
        return 0;
      }
      accumulator += elapsed * speed;
      const wanted = Math.floor(accumulator / TICK_MS);
      const ran = Math.min(wanted, MAX_CATCHUP_TICKS);
      // Drop the remainder when capped: the game slows down rather than
      // entering a catch-up spiral.
      accumulator = ran >= MAX_CATCHUP_TICKS ? 0 : accumulator - ran * TICK_MS;
      runTicks(ran);
      for (let k = 0; k < ran; k++) {
        tickTimes.push(nowMs);
      }
      return ran;
    },

    setSpeedIndex(index: number): void {
      if (!Number.isSafeInteger(index) || index < 0 || index >= SPEED_STEPS.length) {
        throw new RangeError(`speed index must be an integer in 0..${SPEED_STEPS.length - 1}`);
      }
      speedIndex = index;
      if (index !== 0) {
        lastNonZeroIndex = index;
      }
    },

    togglePause(): void {
      speedIndex = speedIndex === 0 ? lastNonZeroIndex : 0;
    },

    submitLocal(command: { type: string; payload: unknown }): void {
      if (localQueue === null) {
        throw new Error('no local faction in this match; command rejected');
      }
      localQueue.push(command);
    },

    stats(nowMs: number): RuntimeStats {
      while (tickTimes.length > 0 && (tickTimes[0] ?? 0) <= nowMs - TICK_RATE_WINDOW_MS) {
        tickTimes.shift();
      }
      const timings = sim.timings();
      const systems: RuntimeStats['systems'] = [];
      for (const [id, record] of Object.entries(timings)) {
        const prev = prevTimings[id] ?? { count: 0, total: 0 };
        const calls = record.count - prev.count;
        const total = record.total - prev.total;
        if (calls > 0) {
          systems.push({ id, avgMs: total / calls, calls });
        }
      }
      prevTimings = timings;
      return {
        tick: toTick(sim.tick),
        speedIndex,
        paused: speedIndex === 0,
        tickRate: tickTimes.length,
        entityCount: sim.probes()[ENTITIES_PROBE] ?? 0,
        systems,
      };
    },

    latestSnapshot(): Snapshot {
      return sim.snapshot(observer);
    },

    inspect(handle: EntityHandle | null): Inspection | null {
      return handle === null ? null : sim.inspect(observer, handle);
    },

    takeChangedLayers(): Set<string> {
      const out = new Set(changedLayers);
      changedLayers.clear();
      return out;
    },
  };
}
