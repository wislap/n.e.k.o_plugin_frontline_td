// Worker boundary messages (ADR 0004). The Snapshot/CommandEnvelope payload
// shapes come from core so the client never imports the kernel.
import type { Snapshot, Tick } from '../core/index';

// ADR 0005: index 0 is paused; indices are multipliers of base speed.
export const SPEED_STEPS = [0, 1, 2, 3] as const;

export type MainToWorker =
  | { kind: 'start'; setup: unknown }
  | { kind: 'command'; command: { type: string; payload: unknown } }
  | { kind: 'set_speed'; index: number }
  | { kind: 'toggle_pause' };

export interface SystemTiming {
  id: string;
  avgMs: number;
  calls: number;
}

export interface RuntimeStats {
  tick: Tick;
  speedIndex: number;
  paused: boolean;
  // Ticks simulated in the last wall-clock second.
  tickRate: number;
  entityCount: number;
  systems: SystemTiming[];
}

export type WorkerToMain =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'stats'; stats: RuntimeStats }
  | { kind: 'error'; message: string };
