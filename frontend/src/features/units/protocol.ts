// Units channel descriptor: the dense per-tick unit snapshot layout shared
// by the sim channel builder and the client renderer.
import { defineSnapshotChannel } from '../../core/index';

export interface DenseUnits {
  handles: Float64Array;
  x: Float32Array;
  y: Float32Array;
  kind: Uint16Array;
  faction: Uint16Array;
  moving: Uint8Array;
}

export const DenseUnitsChannel = defineSnapshotChannel<DenseUnits>('frontline_td:units.dense');
