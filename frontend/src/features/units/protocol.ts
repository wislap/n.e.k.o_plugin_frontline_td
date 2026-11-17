// Units channel descriptor + spawn intent/event: the dense per-tick
// unit snapshot layout shared by the sim channel builder and the client
// renderer, plus the sim-internal spawn contract (M4 A3).
import { defineEvent, defineIntent, defineSnapshotChannel } from '../../core/index';

export interface DenseUnits {
  handles: Float64Array;
  x: Float32Array;
  y: Float32Array;
  kind: Uint16Array;
  faction: Uint16Array;
  moving: Uint8Array;
  // hp fraction bp (10000 = full); energy bp, 0xFFFF = no energy slot.
  hpBp: Uint16Array;
  energyBp: Uint16Array;
}

export const DenseUnitsChannel = defineSnapshotChannel<DenseUnits>('frontline_td:units.dense');

// Spawn a unit of content-id `kind` for `faction` at the nearest
// passable free cell around (x, y) — the same spiral as start spawning.
// Resolved in capture_fog so intents from any phase land the same tick;
// the entity exists from the next tick (ADR 0026).
export const SpawnIntent = defineIntent<{
  faction: number;
  kind: string;
  x: number;
  y: number;
  source: number;
}>('frontline_td:units.spawn');

// Emitted when the spawned unit's handle is known (same tick as the
// intent resolves; the entity becomes query-visible next tick).
// `source` is the spawner entity's handle (0 when none).
export const UnitsSpawned = defineEvent<{
  handle: number;
  faction: number;
  kind: string;
  source: number;
}>('frontline_td:units.spawned', 'all');
