// Capture wire surface (M5 batch A): one event construction reacts to
// and one snapshot channel for the client. The channel builder takes
// the observer so batch B vision can filter rows without a protocol
// change.
import { defineEvent, defineSnapshotChannel } from '../../core/index';

// Emitted when a ruin's tug-of-war progress reaches its total under one
// faction. Construction validates the ruin is still live, despawns it
// and spawns a fresh build site for `faction`.
export type CaptureCompletedPayload = {
  // Ruin entity handle (valid within the emitting tick).
  ruin: number;
  faction: number;
  // Structure content index and footprint top-left, mirrored so the
  // listener needs no capture-side state.
  kind: number;
  x: number;
  y: number;
};
export const CaptureCompleted = defineEvent<CaptureCompletedPayload>(
  'frontline_td:capture.completed',
  'all',
);

export interface CapturePoints {
  handles: Float64Array;
  // Capture-circle centre (cells, continuous).
  x: Float32Array;
  y: Float32Array;
  radius: Float32Array;
  // Faction holding progress; 0 when none.
  owner: Uint16Array;
  // progress / total in basis points.
  progressBp: Uint16Array;
  // Faction currently winning the tug; 0 when stalled/tied.
  leader: Uint16Array;
  contested: Uint8Array;
}
export const CapturePointsChannel = defineSnapshotChannel<CapturePoints>(
  'frontline_td:capture.points',
);
