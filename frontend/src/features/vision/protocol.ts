// Vision wire surface (M5 batch B): the per-faction fog layer id and
// the observer-scoped memory channel. The layer itself ships inside the
// snapshot's layers map as 'frontline_td:vision.state#<faction>'; the
// channel lists remembered structures whose footprint is NOT currently
// visible (columns mirror the structures channel).
import { defineSnapshotChannel } from '../../core/index';

export const VISION_STATE_LAYER_ID = 'frontline_td:vision.state';

export interface VisionMemory {
  handles: Float64Array;
  // Structure content index (as in the structures channel).
  kind: Uint16Array;
  // Footprint top-left in cells.
  x: Uint16Array;
  y: Uint16Array;
  // Last recorded owner faction; 0 for ruins.
  faction: Uint16Array;
  // Last recorded structures-channel state value.
  state: Uint8Array;
}
export const VisionMemoryChannel = defineSnapshotChannel<VisionMemory>(
  'frontline_td:vision.memory',
);
